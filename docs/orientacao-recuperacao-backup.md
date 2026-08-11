# Recuperação de Backup e Procedimentos de Emergência

**Última atualização:** $(date +%Y-%m-%d)  
**Responsável:** Administrador do Sistema

---

## 1. Visão Geral

Este documento descreve os procedimentos para:
- Restaurar o sistema a partir de backup
- Recuperar de falhas críticas
- Procedimentos de emergência

## 2. Estrutura de Backup

Os backups são gerados pelo script `scripts/backup-prod.sh` e contêm:

```
backups/YYYYMMDDTHHMMSSZ/
├── database.dump          # Dump do PostgreSQL (formato custom)
├── uploads.tar.gz         # Arquivos de upload (/app/uploads)
└── metadata.json          # Metadados do backup
```

**Localização padrão:** `/opt/estoque-teep/backups/` no servidor de produção

## 3. Restauração Completa

### 3.1 Pré-requisitos
- Acesso SSH ao servidor de produção
- Permissões de superusuário (sudo)
- Backup válido disponível

### 3.2 Passo a Passo

```bash
# 1. Acesse o diretório do projeto
cd /opt/estoque-teep

# 2. Pare os containers (opcional, mas recomendado)
docker compose -f docker-compose.prod.yml down

# 3. Execute o restore
#    BACKUP_DIR: pasta do backup (ex: backups/20250101T120000Z)
#    RESTORE_UPLOADS=1: também restaura arquivos de upload
RESTORE_UPLOADS=1 ./scripts/restore-prod.sh backups/20250101T120000Z

# 4. Reinicie os serviços
docker compose -f docker-compose.prod.yml up -d
```

### 3.3 Verificação Pós-Restore

```bash
# Verifique saúde dos serviços
curl -sS https://api.estoque.teep.com.br/health
curl -sS https://api.estoque.teep.com.br/ready

# Verifique logs
docker compose -f docker-compose.prod.yml logs --tail=50 api
```

## 4. Restauração Parcial

### 4.1 Apenas Banco de Dados

```bash
# Sem RESTORE_UPLOADS restaura apenas o banco
./scripts/restore-prod.sh backups/20250101T120000Z
```

### 4.2 Apenas Arquivos de Upload

```bash
# Extrai manualmente os uploads
tar -xzf backups/20250101T120000Z/uploads.tar.gz -C /tmp/
# Copie para o volume Docker
sudo cp -r /tmp/uploads/* /var/lib/docker/volumes/estoque-teep_api_uploads/_data/
```

## 5. Procedimentos de Emergência

### 5.1 API Não Responde

```bash
# 1. Verifique logs
docker compose -f docker-compose.prod.yml logs api

# 2. Reinicie o serviço
docker compose -f docker-compose.prod.yml restart api

# 3. Se persistir, verifique dependências
docker compose -f docker-compose.prod.yml ps
curl http://postgres:5432  # Dentro da rede Docker
```

### 5.2 Banco de Dados Corrompido

```bash
# 1. Pare os serviços
docker compose -f docker-compose.prod.yml down

# 2. Restaure do último backup
./scripts/restore-prod.sh $(ls -td backups/* | head -1)

# 3. Reinicie
docker compose -f docker-compose.prod.yml up -d
```

### 5.3 Perda de Arquivos de Upload

```bash
# Restaure apenas uploads do backup mais recente
RESTORE_UPLOADS=1 ./scripts/restore-prod.sh $(ls -td backups/* | head -1)
```

## 6. Monitoramento e Alertas

### 6.1 Verificações Diárias

```bash
# Health check automatizado (exemplo de cron)
0 8 * * * curl -sS --fail https://api.estoque.teep.com.br/health || echo "API offline" | mail -s "Alerta Estoque TEEP" admin@teep.com.br
```

### 6.2 Verificação de Backups

```bash
# Verifique se backups estão sendo gerados
ls -la /opt/estoque-teep/backups/

# Verifique integridade do último backup
./scripts/restore-prod.sh --verify $(ls -td backups/* | head -1)
```

## 7. Contatos de Emergência

| Função | Nome | Contato | Disponibilidade |
|--------|------|---------|-----------------|
| Administrador Sistema | | | 24/7 |
| Suporte Técnico | | | Horário comercial |
| Gerente Operacional | | | Horário comercial |

## 8. Checklist de Recuperação

- [ ] Identificar causa raiz da falha
- [ ] Escolher backup apropriado (mais recente consistente)
- [ ] Notificar usuários sobre indisponibilidade
- [ ] Executar restore
- [ ] Validar restauração (login, dados críticos)
- [ ] Documentar incidente
- [ ] Implementar medidas preventivas

## 9. Manutenção Preventiva

### 9.1 Mensal
- [ ] Testar restore em ambiente de staging
- [ ] Verificar espaço em disco para backups
- [ ] Revisar logs de erro

### 9.2 Trimestral
- [ ] Atualizar este documento
- [ ] Revisar política de retenção de backups
- [ ] Treinar equipe nos procedimentos

---

**Nota:** Este documento deve ser revisado após cada incidente significativo ou mudança na infraestrutura.