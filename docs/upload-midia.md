# Upload de mídia

**Status:** implementado.  
**Escopos:** avatar · fotos de produto · NF / documentos de lançamento · anexos RMA.

Sem S3/CDN: disco local na API (`UPLOAD_DIR`) + `GET /uploads/*` autenticado. Paths no DB são **relativos**.

---

## Princípios

1. **Upload ≠ save da entidade** — `POST /upload` grava arquivo e devolve `{ url }`; PATCH/create persiste o path.
2. **DB só path relativo** — ex. `/uploads/fotos-perfil/...` (nunca URL com host).
3. Pastas por contexto; rate limit **20/min**; MIME por magic bytes.
4. Front: `resolveAssetUrl` anexa `?token=` JWT para `<img src>`.

---

## Pastas

Base: `UPLOAD_DIR` (prod Docker: `/app/uploads` no volume `api_uploads`). Dev: tipicamente sob `apps/api/uploads/`.

```text
uploads/
├── fotos-perfil/{usuarioId}-{hash12}.{ext}
├── conteudo/produtos/{produtoId}/{hash12}.{ext}
├── notas-fiscais/{usuarioId}-{hash12}.{ext}
├── movimentacao-anexos/{usuarioId}-{hash12}.{ext}
└── (tmp RMA via rmaUploads)
```

---

## Contextos (`POST /upload`)

Campo multipart: `file` + `context` (+ extras).

| `context` | MIME | Extras / ACL |
|-----------|------|----------------|
| `perfil` | JPEG/PNG/GIF/WebP | `usuarioId` opcional (só Admin para outro); próprio usuário ok |
| `produto` | imagens | `produtoId` **obrigatório**; Admin ou `cadastros_produtos_editar`; Operador **não** |
| `nota-fiscal` | PDF + imagens | permissão lançamentos / rma / rma_cobranca |
| `documento` | PDF/Word + imagens | idem (termo comodato etc.) |
| `rma` | NF: PDF+img · laudo (`kind=laudo`): + Word | permissão rma / rma_cobranca; arquivo tmp até anexar no processo |

Limite: `UPLOAD_MAX_BYTES` (padrão 10 MB).

---

## Persistência

| Campo | Modelo |
|-------|--------|
| `fotoPerfil` | Usuario — 1 path |
| `fotos` | Produto — `string[]` ordenada (1ª = capa) |

- Avatar: upload → `PATCH /auth/me` ou `PATCH /usuarios/:id` com `fotoPerfil`.
- Produto **novo:** UI guarda arquivos pendentes; após `POST /produtos` faz upload com `produtoId` e `PATCH` `fotos` (create não exige fotos no body; schema de create não inclui galeria como obrigatório).
- Produto **edição:** upload + PATCH `fotos`; reordenar/remover na UI.
- Purge órfãos best-effort no upload/PATCH de avatar e produto.

---

## Estático

`GET /uploads/*` — Bearer **ou** `?token=` (access JWT).  
Backup: pasta uploads no `backup-prod.sh` (volume `api_uploads`).

---

## UI

- Admin → Usuários / Perfil: avatar  
- Cadastros → Produtos: galeria  
- AppShell: avatar + iniciais se vazio  
- Listas: thumb da 1ª foto  
- Lançamento / RMA: NF e documentos via mesmos contexts  

Helper: `apps/web/src/lib/assets.ts` · upload: `apiUpload`.

---

## Env

```env
UPLOAD_DIR=./uploads
UPLOAD_MAX_BYTES=10485760
```

---

## Do / Don’t

**Do:** path relativo; pasta por contexto; auth em upload e leitura.  
**Don’t:** host de dev no DB; foto de produto sem `produtoId`; confiar só na extensão do arquivo.
