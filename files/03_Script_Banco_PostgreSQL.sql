-- ============================================================
--  TEEP — SISTEMA DE CONTROLE DE ESTOQUE
--  Banco de dados: PostgreSQL
--  Gerado em: 2026-06-22
-- ============================================================

-- Extensão para UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USUÁRIOS
--    Perfis: admin | gestor | operador | visualizador
-- ============================================================
CREATE TABLE usuarios (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome         VARCHAR(120)  NOT NULL,
    email        VARCHAR(120)  NOT NULL UNIQUE,
    senha_hash   VARCHAR(255)  NOT NULL,
    perfil       VARCHAR(20)   NOT NULL DEFAULT 'operador'
                     CHECK (perfil IN ('admin','gestor','operador','visualizador')),
    filial       VARCHAR(60),                    -- filial principal do usuário
    ativo        BOOLEAN       NOT NULL DEFAULT TRUE,
    criado_em    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  usuarios             IS 'Usuários do sistema';
COMMENT ON COLUMN usuarios.perfil      IS 'admin=tudo | gestor=relatórios+aprovar | operador=lançar | visualizador=somente leitura';
COMMENT ON COLUMN usuarios.filial      IS 'Filial de origem do usuário (pode operar em outras)';


-- ============================================================
-- 2. CATEGORIAS DE PRODUTOS
-- ============================================================
CREATE TABLE categorias (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        VARCHAR(80)  NOT NULL UNIQUE,
    descricao   TEXT,
    ativo       BOOLEAN      NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE categorias IS 'Categorias dos produtos (ex: Fontes, Módulos, Cabos)';

-- Seed com categorias já usadas
INSERT INTO categorias (nome) VALUES
    ('Eletrônico'),
    ('Adesivos'),
    ('Cabos'),
    ('Gabinetes'),
    ('Conectores'),
    ('Fontes'),
    ('Módulos'),
    ('Fixação'),
    ('Acessórios'),
    ('Dispositivos');


-- ============================================================
-- 3. PRODUTOS
-- ============================================================
CREATE TABLE produtos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          VARCHAR(40)     NOT NULL UNIQUE,
    descricao       VARCHAR(200)    NOT NULL,
    categoria_id    UUID            NOT NULL REFERENCES categorias(id),
    unidade         VARCHAR(10)     NOT NULL DEFAULT 'UN',
    preco_unitario  NUMERIC(12,2)   NOT NULL DEFAULT 0,
    estoque_minimo  INTEGER         NOT NULL DEFAULT 0,  -- alerta abaixo deste valor
    ativo           BOOLEAN         NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  produtos                  IS 'Catálogo de produtos';
COMMENT ON COLUMN produtos.codigo           IS 'Código único do produto (ex: TMP-1088-W)';
COMMENT ON COLUMN produtos.estoque_minimo   IS 'Saldo mínimo — abaixo gera alerta';


-- ============================================================
-- 4. CLIENTES / PARCEIROS
--    tipo: cliente | fornecedor | filial | interno
-- ============================================================
CREATE TABLE clientes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        VARCHAR(150)  NOT NULL,
    documento   VARCHAR(20),                 -- CNPJ ou CPF
    tipo        VARCHAR(20)   NOT NULL DEFAULT 'cliente'
                    CHECK (tipo IN ('cliente','fornecedor','filial','interno')),
    email       VARCHAR(120),
    telefone    VARCHAR(20),
    cidade      VARCHAR(80),
    estado      CHAR(2),
    observacao  TEXT,
    ativo       BOOLEAN       NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  clientes       IS 'Clientes, fornecedores e filiais envolvidos nas movimentações';
COMMENT ON COLUMN clientes.tipo  IS 'cliente=destino de saída | fornecedor=origem de entrada | filial=transferência | interno=uso interno';

-- Seed com filiais já conhecidas
INSERT INTO clientes (nome, tipo, cidade, estado) VALUES
    ('Filial Paulínia',         'filial',    'Paulínia',  'SP'),
    ('Filial Timbó',            'filial',    'Timbó',     'SC'),
    ('Almoxarifado Central',    'interno',   'Paulínia',  'SP'),
    ('ArqPlast',                'cliente',   '',          ''),
    ('OEmPlastico',             'cliente',   '',          '');


-- ============================================================
-- 5. TIPOS DE MOVIMENTAÇÃO
--    operacao: ENTRADA | SAÍDA
-- ============================================================
CREATE TABLE tipos_movimentacao (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        VARCHAR(60)   NOT NULL UNIQUE,
    operacao    CHAR(6)       NOT NULL CHECK (operacao IN ('ENTRADA','SAÍDA')),
    descricao   TEXT,
    ativo       BOOLEAN       NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE  tipos_movimentacao           IS 'Classificação das movimentações';
COMMENT ON COLUMN tipos_movimentacao.operacao  IS 'ENTRADA = soma ao saldo | SAÍDA = subtrai do saldo';

INSERT INTO tipos_movimentacao (nome, operacao, descricao) VALUES
    ('Compra',                    'ENTRADA', 'Recebimento de fornecedor'),
    ('Inventário / Saldo Inicial','ENTRADA', 'Contagem física ou abertura de saldo'),
    ('Devolução de Cliente',      'ENTRADA', 'Item retornado por cliente'),
    ('Transferência Recebida',    'ENTRADA', 'Recebimento de outra filial'),
    ('Ajuste Positivo',           'ENTRADA', 'Correção de saldo para mais'),
    ('Venda / Entrega',           'SAÍDA',   'Saída para cliente externo'),
    ('Montagem / Produção',       'SAÍDA',   'Consumo em montagem de produto'),
    ('Transferência Enviada',     'SAÍDA',   'Envio para outra filial'),
    ('Perda / Avaria',            'SAÍDA',   'Item danificado ou perdido'),
    ('Ajuste Negativo',           'SAÍDA',   'Correção de saldo para menos');


-- ============================================================
-- 6. ESTOQUES (saldo por produto × filial)
--    Atualizado automaticamente pela trigger abaixo
-- ============================================================
CREATE TABLE estoques (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    produto_id      UUID            NOT NULL REFERENCES produtos(id),
    filial          VARCHAR(60)     NOT NULL,
    saldo_atual     NUMERIC(12,3)   NOT NULL DEFAULT 0,
    atualizado_em   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (produto_id, filial)
);

COMMENT ON TABLE estoques IS 'Saldo atual de cada produto por filial — atualizado automaticamente pelas movimentações';


-- ============================================================
-- 7. MOVIMENTAÇÕES  (tabela principal — nunca apagar registros)
-- ============================================================
CREATE TABLE movimentacoes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    produto_id      UUID            NOT NULL REFERENCES produtos(id),
    tipo_id         UUID            NOT NULL REFERENCES tipos_movimentacao(id),
    usuario_id      UUID            NOT NULL REFERENCES usuarios(id),
    cliente_id      UUID                     REFERENCES clientes(id),   -- quem enviou ou recebeu
    filial          VARCHAR(60)     NOT NULL,
    operacao        CHAR(6)         NOT NULL CHECK (operacao IN ('ENTRADA','SAÍDA')),
    quantidade      NUMERIC(12,3)   NOT NULL CHECK (quantidade > 0),
    preco_unitario  NUMERIC(12,2)   NOT NULL DEFAULT 0,
    valor_total     NUMERIC(14,2)   GENERATED ALWAYS AS (quantidade * preco_unitario) STORED,
    observacao      TEXT,
    data_movimento  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    criado_em       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  movimentacoes                IS 'Registro imutável de todas as movimentações de estoque';
COMMENT ON COLUMN movimentacoes.cliente_id     IS 'Preenchido em saídas (para quem foi) e em devoluções (de quem voltou)';
COMMENT ON COLUMN movimentacoes.operacao       IS 'Copiado do tipo_movimentacao — facilita queries sem JOIN';
COMMENT ON COLUMN movimentacoes.valor_total    IS 'Calculado automaticamente: quantidade × preco_unitario';

-- Índices para performance
CREATE INDEX idx_mov_produto    ON movimentacoes(produto_id);
CREATE INDEX idx_mov_filial     ON movimentacoes(filial);
CREATE INDEX idx_mov_data       ON movimentacoes(data_movimento DESC);
CREATE INDEX idx_mov_cliente    ON movimentacoes(cliente_id);
CREATE INDEX idx_mov_tipo       ON movimentacoes(tipo_id);
CREATE INDEX idx_mov_operacao   ON movimentacoes(operacao);


-- ============================================================
-- 8. TRIGGER — atualiza saldo automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION atualizar_saldo()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Garante que o registro de saldo existe
    INSERT INTO estoques (produto_id, filial, saldo_atual)
    VALUES (NEW.produto_id, NEW.filial, 0)
    ON CONFLICT (produto_id, filial) DO NOTHING;

    -- Atualiza o saldo conforme a operação
    UPDATE estoques SET
        saldo_atual   = saldo_atual + CASE
                            WHEN NEW.operacao = 'ENTRADA' THEN  NEW.quantidade
                            WHEN NEW.operacao = 'SAÍDA'   THEN -NEW.quantidade
                        END,
        atualizado_em = NOW()
    WHERE produto_id = NEW.produto_id
      AND filial     = NEW.filial;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_atualizar_saldo
AFTER INSERT ON movimentacoes
FOR EACH ROW EXECUTE FUNCTION atualizar_saldo();


-- ============================================================
-- 9. VIEW — saldo consolidado com alerta de mínimo
-- ============================================================
CREATE VIEW vw_saldo_estoque AS
SELECT
    p.codigo,
    p.descricao,
    c.nome                              AS categoria,
    p.unidade,
    p.preco_unitario,
    e.filial,
    e.saldo_atual,
    p.estoque_minimo,
    (e.saldo_atual * p.preco_unitario)  AS valor_em_estoque,
    CASE
        WHEN e.saldo_atual <= 0               THEN 'ZERADO'
        WHEN e.saldo_atual < p.estoque_minimo THEN 'ABAIXO DO MÍNIMO'
        ELSE 'OK'
    END                                 AS status_estoque,
    e.atualizado_em
FROM estoques e
JOIN produtos    p ON p.id = e.produto_id
JOIN categorias  c ON c.id = p.categoria_id
ORDER BY c.nome, p.descricao;

COMMENT ON VIEW vw_saldo_estoque IS 'Saldo atual com status de alerta — use esta view nos relatórios';


-- ============================================================
-- 10. VIEW — histórico de movimentações (relatório principal)
-- ============================================================
CREATE VIEW vw_historico_movimentacoes AS
SELECT
    m.data_movimento,
    m.operacao,
    tm.nome                             AS tipo,
    p.codigo,
    p.descricao                         AS produto,
    m.quantidade,
    p.unidade,
    m.preco_unitario,
    m.valor_total,
    m.filial,
    cl.nome                             AS cliente,
    cl.tipo                             AS tipo_cliente,
    u.nome                              AS usuario,
    m.observacao,
    m.id                                AS movimentacao_id
FROM movimentacoes m
JOIN produtos           p  ON p.id  = m.produto_id
JOIN tipos_movimentacao tm ON tm.id = m.tipo_id
JOIN usuarios           u  ON u.id  = m.usuario_id
LEFT JOIN clientes      cl ON cl.id = m.cliente_id
ORDER BY m.data_movimento DESC;

COMMENT ON VIEW vw_historico_movimentacoes IS 'Histórico completo com todos os JOINs resolvidos';


-- ============================================================
-- FIM DO SCRIPT
-- ============================================================
