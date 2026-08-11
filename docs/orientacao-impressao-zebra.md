# Sistema de Impressão - Impressora Zebra ZD220

**Status: STANDBY (2026-08-07)** — não entra na fila de desenvolvimento agora.

**Motivo:** custo/benefício alto frente ao software já usado nas estações (Zebra Setup Utilities / driver) para etiqueta padrão. A geração de séries no Estoque TEEP continua; a impressão fica fora do sistema até nova decisão.

**Funcionalidade (especificação futura):** integração com impressoras de etiquetas Zebra

---

## 1. Visão Geral

Sistema de impressão de etiquetas para números de série usando impressoras Zebra ZD220, com suporte para:
- **Conexão USB** (principal) e **TCP/IP** (opcional)
- **Linguagem ZPL** (Zebra Programming Language)
- **Impressão direta** do navegador
- **Layouts configuráveis** de etiqueta

## 2. Hardware - Zebra ZD220

### 2.1 Especificações Técnicas
- **Modelo:** Zebra ZD220
- **Tipo:** Impressora térmica direta
- **Largura máxima:** 2.2" (56mm)
- **Resolução:** 203 dpi (8 pontos/mm)
- **Velocidade:** até 5 ips (127 mm/s)
- **Memória:** 64 MB RAM, 128 MB Flash

### 2.2 Conexões Suportadas
- **USB 2.0** (principal para nosso uso)
- **Ethernet** 10/100 (opcional)
- **Serial** RS-232 (opcional)
- **Bluetooth** (opcional, não recomendado para produção)

### 2.3 Consumíveis
- **Etiquetas:** 1.0" x 1.5" até 2.2" x 4.0"
- **Ribbon:** Wax (padrão) ou Wax/Resina
- **Durabilidade:** 6-12 meses em ambiente interno

## 3. Arquitetura do Sistema

### 3.1 Visão Geral
```
Frontend (Next.js) → API (Express) → Driver Zebra → Impressora ZD220
                     ↓
              (ZPL Generator)
```

### 3.2 Fluxo de Impressão
```
1. Usuário gera números de série
2. Sistema mostra preview da etiqueta
3. Usuário seleciona impressora (se múltiplas)
4. Sistema envia comando ZPL para impressora
5. Impressora imprime etiqueta(s)
6. Sistema registra log da impressão
```

### 3.3 Considerações de Nuvem
- **Sistema na nuvem**, impressão local
- **Cada estação** imprime na impressora conectada a ela
- **Não há** impressão remota entre filiais
- **Configuração por estação** (não centralizada)

## 4. Configuração da Impressora

### 4.1 Instalação do Driver
```bash
# 1. Baixar driver da Zebra
# https://www.zebra.com/us/en/support-downloads/printers/desktop/zd220.html

# 2. Instalar "Zebra Setup Utilities"
# 3. Configurar porta USB
# 4. Testar impressão de configuração
```

### 4.2 Configuração via Browser
```javascript
// O navegador precisa de permissão para acessar portas seriais
// Chrome/Edge: chrome://flags/#enable-experimental-web-platform-features
```

### 4.3 Configuração de Rede (Opcional)
```bash
# Se usar TCP/IP:
1. Conectar impressora à rede
2. Configurar IP fixo via painel frontal
3. Testar: ping <ip-da-impressora>
4. Configurar porta 9100 aberta
```

## 5. Linguagem ZPL (Zebra Programming Language)

### 5.1 Comandos Básicos
```zpl
^XA          # Início do formato
^FO20,20     # Field Origin (posição X,Y)
^A0N,30,30   # Fonte (0=padrão, tamanho 30x30)
^FDTexto^FS  # Field Data + Field Separator
^XZ          # Fim do formato
```

### 5.2 Template Básico de Etiqueta
```zpl
^XA
^MMT        # Modo de impressão térmico
^PW400      # Largura do papel (400 dots = 2")
^LL200      # Comprimento do label (200 dots = 1")
^LS0        # Deslocamento zero
^FT20,30    # Posição (20,30)
^A0N,20,20  # Fonte padrão 20x20
^FDProduto:^FS

^FT20,60
^A0N,25,25
^FDTMP4426^FS

^FT20,100
^A0N,20,20
^FDNúmero de Série:^FS

^FT20,130
^A0N,25,25
^FDTMP4426250001^FS

^FT20,170
^A0N,15,15
^FD15/01/2025 14:30^FS

^FO20,200    # Código de barras Code 128
^BCN,60,Y,N,N
^FDTMP4426250001^FS

^XZ
```

### 5.3 Códigos de Barras Suportados
- **Code 128:** `^BC` (padrão industrial)
- **Code 39:** `^B3`
- **QR Code:** `^BQ`
- **DataMatrix:** `^BX`

## 6. Integração com o Sistema

### 6.1 API de Impressão
```typescript
// Endpoints
POST /api/impressao/imprimir-etiqueta
POST /api/impressao/imprimir-lote
GET  /api/impressao/impressoras
POST /api/impressao/testar-conexao
GET  /api/impressao/logs
```

### 6.2 Payload de Impressão
```json
{
  "impressoraId": "usb://vid_05cf/pid_2027",
  "tipo": "INDIVIDUAL", // ou "LOTE"
  "etiquetas": [
    {
      "numeroSerie": "TMP4426250001",
      "codigoProduto": "TMP4426",
      "descricao": "Notebook Dell i7",
      "data": "2025-01-15T14:30:00",
      "template": "PADRAO" // ou "COMPACTO", "DETALHADO"
    }
  ],
  "copias": 1,
  "config": {
    "largura": 400,  // dots
    "altura": 200,   // dots
    "densidade": 203 // dpi
  }
}
```

### 6.3 Serviço de Impressão
```typescript
class ZebraPrintService {
  async imprimirEtiqueta(
    impressora: ImpressoraConfig,
    etiqueta: EtiquetaData
  ): Promise<PrintResult> {
    // 1. Gerar ZPL baseado no template
    const zpl = this.gerarZPL(etiqueta);
    
    // 2. Enviar para impressora
    if (impressora.tipo === 'USB') {
      return this.enviarViaUSB(impressora, zpl);
    } else if (impressora.tipo === 'TCPIP') {
      return this.enviarViaTCP(impressora, zpl);
    }
  }
  
  private gerarZPL(etiqueta: EtiquetaData): string {
    // Template engine para ZPL
    return `
      ^XA
      ^FO20,30^A0N,25,25^FD${etiqueta.codigoProduto}^FS
      ^FO20,60^A0N,30,30^FD${etiqueta.numeroSerie}^FS
      ^FO20,100^BCN,60,Y,N,N^FD${etiqueta.numeroSerie}^FS
      ^XZ
    `;
  }
}
```

## 7. Frontend - Interface do Usuário

### 7.1 Componente de Impressão
```typescript
// Componente React para impressão
function ImpressaoEtiquetaModal({ series, onClose }) {
  const [impressora, setImpressora] = useState(null);
  const [template, setTemplate] = useState('PADRAO');
  const [copias, setCopias] = useState(1);
  
  const imprimir = async () => {
    // 1. Buscar impressoras disponíveis
    const impressoras = await api.impressao.listar();
    
    // 2. Se USB, pedir permissão do navegador
    if (impressora.tipo === 'USB') {
      await navigator.serial.requestPort();
    }
    
    // 3. Enviar para impressão
    await api.impressao.imprimirLote({
      impressoraId: impressora.id,
      etiquetas: series,
      template,
      copias
    });
  };
  
  return (
    <Modal>
      <h3>Imprimir Etiquetas</h3>
      <SelectImpressora value={impressora} onChange={setImpressora} />
      <SelectTemplate value={template} onChange={setTemplate} />
      <InputNumber value={copias} onChange={setCopias} min={1} max={10} />
      <PreviewEtiqueta series={series} template={template} />
      <Button onClick={imprimir}>Imprimir</Button>
    </Modal>
  );
}
```

### 7.2 Detecção de Impressoras
```javascript
// Para USB (Web Serial API)
async function listarImpressorasUSB() {
  if (!'serial' in navigator) {
    throw new Error('Web Serial não suportado');
  }
  
  const ports = await navigator.serial.getPorts();
  return ports.map(port => ({
    id: `usb://${port.getInfo().usbVendorId}/${port.getInfo().usbProductId}`,
    nome: port.getInfo().usbProductName || 'Impressora USB',
    tipo: 'USB'
  }));
}

// Para TCP/IP (configuração manual)
const impressorasTCP = [
  { id: 'tcp://192.168.1.100:9100', nome: 'Zebra Filial 1', tipo: 'TCPIP' },
  { id: 'tcp://192.168.1.101:9100', nome: 'Zebra Filial 2', tipo: 'TCPIP' }
];
```

## 8. Layouts de Etiqueta

### 8.1 Template PADRÃO (2" x 1")
```
┌──────────────────────────┐
│ TMP4426                  │
│                          │
│ TMP4426250001            │
│                          │
│ [CODE 128]               │
│ ███▀▀█▀█▀███▀█▀██▀███▀█  │
│                          │
│ 15/01/2025 14:30         │
└──────────────────────────┘
```

### 8.2 Template COMPACTO (1.5" x 1")
```
┌──────────────────┐
│ TMP4426250001    │
│                  │
│ [CODE 128]       │
│ ███▀▀█▀█▀███▀█▀  │
│                  │
│ 15/01/2025       │
└──────────────────┘
```

### 8.3 Template DETALHADO (2" x 2")
```
┌──────────────────────────┐
│ NOTEBOOK DELL I7         │
│ Modelo: Latitude 5420    │
│                          │
│ TMP4426250001            │
│                          │
│ [CODE 128 + QR CODE]     │
│ ███▀▀█▀█▀███▀█▀██▀███▀█  │
│ █▀█▀█▀█▀█▀█▀█▀█▀█▀█▀█▀█  │
│                          │
│ Entrada: 15/01/2025      │
│ Operador: João Silva     │
└──────────────────────────┘
```

## 9. Configuração por Produto

### 9.1 Cadastro de Produto
```typescript
interface ConfigImpressaoProduto {
  produtoId: string;
  templatePadrao: 'PADRAO' | 'COMPACTO' | 'DETALHADO';
  incluirQRCode: boolean;
  qrCodeUrl: string; // ex: "https://estoque.teep.com.br/serie/{serie}"
  camposPersonalizados: Array<{
    nome: string;
    valor: string; // ou template: "{codigo}-{data}"
    posicao: { x: number; y: number };
    fonte: { tipo: string; tamanho: number };
  }>;
}
```

### 9.2 Exemplo de Configuração
```json
{
  "produtoId": "uuid-tmp4426",
  "templatePadrao": "DETALHADO",
  "incluirQRCode": true,
  "qrCodeUrl": "https://estoque.teep.com.br/produto/TMP4426/serie/{serie}",
  "camposPersonalizados": [
    {
      "nome": "modelo",
      "valor": "Latitude 5420",
      "posicao": { "x": 20, "y": 40 },
      "fonte": { "tipo": "0", "tamanho": 20 }
    }
  ]
}
```

## 10. Implementação Passo a Passo

### Fase 1: Configuração Básica (1 semana)
- [ ] Instalar drivers Zebra nas estações
- [ ] Testar impressão manual (utilitário Zebra)
- [ ] Configurar templates ZPL básicos
- [ ] Implementar API de geração ZPL

### Fase 2: Integração Frontend (2 semanas)
- [ ] Componente de seleção de impressora
- [ ] Preview de etiqueta no navegador
- [ ] Integração Web Serial API (USB)
- [ ] Controle de cópias e templates

### Fase 3: Integração Completa (1 semana)
- [ ] Conectar com sistema de geração de séries
- [ ] Implementar fila de impressão
- [ ] Logs e auditoria
- [ ] Configuração por produto

### Fase 4: Otimizações (1 semana)
- [ ] Cache de templates ZPL
- [ ] Impressão em lote otimizada
- [ ] Fallback para TCP/IP se USB falhar
- [ ] Dashboard de status das impressoras

## 11. Troubleshooting

### Problema: Navegador não acessa porta serial
**Solução:**
1. Chrome/Edge: Ativar `chrome://flags/#enable-experimental-web-platform-features`
2. HTTPS obrigatório para Web Serial API
3. Conceder permissão uma vez por site

### Problema: Impressora não responde
**Solução:**
1. Verificar conexão USB
2. Testar com utilitário Zebra
3. Reiniciar impressora
4. Verificar papel/ribbon

### Problema: Etiqueta mal formatada
**Solução:**
1. Calibrar sensor de papel (`^JC` command)
2. Ajustar tamanho no template ZPL
3. Verificar densidade (203 dpi padrão)

## 12. Segurança e Auditoria

### 12.1 Logs de Impressão
```prisma
model LogImpressao {
  id          String   @id @default(uuid()) @db.Uuid
  usuarioId   String   @map("usuario_id") @db.Uuid
  produtoId   String   @map("produto_id") @db.Uuid
  numeroSerie String   @map("numero_serie") @db.VarChar(80)
  impressora  String   @db.VarChar(100)
  template    String   @db.VarChar(50)
  copias      Int
  dataHora    DateTime @default(now()) @map("data_hora") @db.Timestamptz
  sucesso     Boolean
  erro        String?  @db.Text
  
  usuario Usuario @relation(fields: [usuarioId], references: [id])
  produto Produto @relation(fields: [produtoId], references: [id])
}
```

### 12.2 Permissões
- **OPERADOR:** Imprimir etiquetas
- **GERENTE:** + Configurar templates
- **ADMIN:** + Acessar logs, configurar impressoras

## 13. Referências

### 13.1 Documentação Zebra
- [Manual ZD220](https://www.zebra.com/content/dam/zebra/manuals/printers/desktop/zd220-user-guide-pt.pdf)
- [Guia ZPL](https://www.zebra.com/content/dam/zebra/manuals/printers/common/programming/zpl-zbi2-pm-en.pdf)
- [Drivers e Software](https://www.zebra.com/us/en/support-downloads/printers/desktop/zd220.html)

### 13.2 APIs Web
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/USB) (alternativa)

### 13.3 Bibliotecas Úteis
- `node-zpl`: Geração de ZPL em Node.js
- `zebra-web`: Comunicação com impressoras via browser
- `qrcode`: Geração de QR Codes

---

**Nota:** Testar extensivamente em diferentes navegadores (Chrome, Edge) antes de produção.