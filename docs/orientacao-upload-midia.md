# Upload de mídia — Avatar de usuário + Fotos de produto

**Status:** **implementado** (F13) — avatar de usuário + galeria de produto.

**Orientação de arquitetura:** programador **Alex Trova**.

Decisões no plano: **D41–D47**. Fase sugerida: **F13**.

---

## 1. Objetivo no TEEP

| Entidade | Mídia | Onde aparece |
|----------|--------|----------------|
| **Usuário** | 1 foto de perfil (avatar) | Área Admin → Usuários; header / AppShell |
| **Produto** | Galeria ordenada (1..N fotos) | Cadastros → Produtos; lançamento / saldos (thumbnail) |

Sem S3/CDN no MVP: disco local na API + servir estático. Evolução futura (object storage) não muda paths relativos no DB.

---

## 2. Princípios

1. **Upload ≠ save da entidade** — `POST /upload` grava arquivo e devolve path relativo; o create/PATCH do usuário/produto é quem persiste no banco.
2. **DB só com path relativo** — ex.: `/uploads/fotos-perfil/...`. Nunca `http://localhost:4000/...`.
3. **Pastas obrigatórias** — nada solto na raiz de `uploads/`.
4. **Avatar ≠ produto** — pastas e campos distintos.
5. **Auth + ACL** no upload; rate limit no endpoint.
6. **Front resolve URL absoluta só na borda** (`resolveAssetUrl(path)` → `NEXT_PUBLIC_API_URL + path`).

---

## 3. Estrutura de pastas (TEEP)

Base: `UPLOAD_DIR` ou default `apps/api/uploads/` (gitignore).

```
apps/api/uploads/
├── fotos-perfil/
│   └── {usuarioId}-{hash12}.{ext}
└── conteudo/
    └── produtos/
        └── {produtoId}/
            └── {hash12}.{ext}
```

Servir via Express: `GET /uploads/*` → arquivos sob a base (somente leitura), **com autenticação** (Bearer ou `?token=` JWT de acesso — necessário para `<img src>`).

**Não** misturar avatares com fotos de produto. **Não** criar pastas `files-*` genéricas na raiz.

---

## 4. Naming

| Tipo | Padrão |
|------|--------|
| Avatar | `{usuarioId}-{hash12}.{ext}` em `fotos-perfil/` |
| Produto | `{hash12}.{ext}` dentro de `conteudo/produtos/{produtoId}/` |
| Hash | 12 hex (conteúdo ou random seguro) |
| Ext | Derivada do MIME validado: `jpg` / `png` / `gif` / `webp` |

---

## 5. Modelo de dados (proposta)

### Usuario

```prisma
fotoPerfil  String?  @map("foto_perfil") @db.VarChar(255)
```

Valor: `/uploads/fotos-perfil/{usuarioId}-{hash}.{ext}` ou `null`.

### Produto

```prisma
fotos  Json  @default("[]")  // string[] ordenada de paths relativos
```

Exemplo: `["/uploads/conteudo/produtos/{id}/a1b2....jpg", "..."]`.

Primeira foto = capa (thumbnail em listas).

---

## 6. API (proposta)

### Upload

`POST /upload` (multipart)

| Campo | Uso |
|-------|-----|
| `file` | arquivo |
| `context` | `perfil` \| `produto` |
| `produtoId` | obrigatório se `context=produto` |
| `usuarioId` | opcional; default = usuário autenticado. Só ADMIN pode uploadar avatar de outro usuário |

**Resposta:** `{ url: "/uploads/..." }`

**Regras**

- Sem `produtoId` em `context=produto` → `400`
- Produto inexistente / inativo → `404`
- Ownership: ADMIN (qualquer); GERENTE (produto); OPERADOR **não** sobe foto de produto; avatar: próprio usuário ou ADMIN
- Limite **10 MB**; MIME **JPEG / PNG / GIF / WebP** (**somente** magic bytes — não confiar no Content-Type)
- Próprio avatar: `POST /upload` + `PATCH /auth/me` `{ fotoPerfil }` (qualquer perfil autenticado)
- Create usuário/produto **não** aceita paths de mídia (só após existir id + upload)
- Rate limit (ex.: 20/min por usuário)

### Persistência

- `PATCH /usuarios/:id` — body pode incluir `fotoPerfil` (path relativo já retornado pelo upload)
- `POST/PATCH /produtos` — body pode incluir `fotos: string[]`
- Ao trocar avatar: apagar arquivo antigo no disco (best-effort)
- Ao remover foto de produto da lista: apagar arquivo órfão (best-effort)
- Soft-delete de produto **não** apaga mídia imediatamente (opcional job depois)

### Estático

`GET /uploads/*` exige JWT (header `Authorization: Bearer` ou query `?token=`).  
`resolveAssetUrl` no front anexa o access token. Soft-delete de produto **não** apaga mídia imediatamente; purge de órfãos roda no upload/PATCH.

---

## 7. ACL (resumo)

| Ação | ADMIN | GERENTE | OPERADOR |
|------|:-----:|:-------:|:--------:|
| Upload/alterar próprio avatar | Sim | Sim | Sim |
| Upload/alterar avatar de outro | Sim | Não | Não |
| Upload/reordenar fotos de produto | Sim | Sim | Não |
| Ver avatar / fotos (leitura via `/uploads` + UI) | Sim | Sim | Sim* |

\*Operador vê thumbnails onde a tela operacional mostrar produto (lançamento, transferência, etc.).

---

## 8. Frontend

### Helpers

```ts
// apps/web/src/lib/assets.ts
export function resolveAssetUrl(path: string | null | undefined): string | null
// path relativo → `${NEXT_PUBLIC_API_URL}${path}`
// já absoluto https → devolver como está
```

Upload com `FormData` + `Authorization` (não usar `api()` JSON puro — variante `apiUpload`).

### UI

1. **Admin → Usuários:** preview circular + botão “Trocar foto”; após upload, PATCH com `fotoPerfil`.
2. **Cadastros → Produtos:** grade de thumbs + adicionar / remover / reordenar; PATCH `fotos`.
3. **AppShell:** avatar pequeno ao lado do nome (fallback iniciais se `null`).
4. **Listas de produto:** thumb da 1ª foto ou placeholder.

Produto novo sem `id`: fluxo sugerido — **criar produto primeiro**, depois upload com `produtoId` (pastas por id). Alternativa: upload temporário `conteudo/produtos/_tmp/{userId}/` e move no create — **evitar no MVP**; exigir id.

---

## 9. Env / Docker / git

```
UPLOAD_DIR=./uploads          # relativo a apps/api ou absoluto
UPLOAD_MAX_BYTES=10485760
```

- `.gitignore`: `apps/api/uploads/**` (manter `.gitkeep` nas pastas-base se quiser)
- Compose: volume `api_uploads:/app/apps/api/uploads` para persistir entre restarts
- Backup F11: incluir pasta `uploads/` junto com Postgres

---

## 10. Do / Don’t

**Do**

- Path relativo no DB  
- Pasta por contexto + por `produtoId`  
- Validar MIME + tamanho  
- Auth em todo upload  
- `resolveAssetUrl` só no front  

**Don’t**

- Absolute URL com host de dev no banco  
- Arquivo na raiz de `uploads/`  
- Avatar e produto na mesma pasta  
- Upload de produto sem `produtoId`  
- Confiar só na extensão do filename  

---

## 11. Ordem de implementação (F13)

1. `UPLOAD_DIR` + static `/uploads` + `.gitignore` + volume Compose  
2. Migration: `usuarios.foto_perfil`, `produtos.fotos`  
3. `POST /upload` (multer ou equivalente) + validação + rate limit  
4. Schemas Zod shared + PATCH usuário/produto  
5. `resolveAssetUrl` + UI Usuários (avatar) + UI Produtos (galeria)  
6. Thumbnails no AppShell e listas operacionais  
7. Limpeza best-effort de arquivo antigo ao substituir/remover  

**DoD:** avatar visível no admin e no shell; produto com ≥1 foto na capa da lista; DB só com paths `/uploads/...`; OPERADOR não sobe foto de produto.

---

## 12. Relação com o plano

| Decisão | Resumo |
|--------|--------|
| D41 | Mídia local em `uploads/` com árvore fixa (perfil vs produto) |
| D42 | DB só path relativo `/uploads/...` |
| D43 | Upload devolve URL; entidade persiste no create/PATCH |
| D44 | Avatar: 1 foto; Produto: array ordenado JSON |
| D45 | MIME JPEG/PNG/GIF/WebP; máx. 10 MB; auth + ACL |
| D46 | Sem S3 no MVP; volume Docker + backup da pasta |
| D47 | `/uploads` autenticado (Bearer ou `?token=`); purge de órfãos no upload/PATCH |

Não bloqueia Go-Live A. Recomendado antes do Go-Live se o time operacional depender de identificação visual no chão.
