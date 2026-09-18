-- Demonstração e comodato sempre pedem série (mesmo em produto sem controla_serie)
UPDATE "tipos_movimentacao"
SET "controle_serie" = 'OBRIGATORIO'
WHERE "codigo" IN ('SAI-DEMO', 'ENT-DEMO', 'SAI-COMODATO', 'ENT-COMODATO')
   OR "nome" IN (
     'Saída Demonstração',
     'Retorno Demonstração',
     'Saída Comodato',
     'Retorno Comodato'
   );
