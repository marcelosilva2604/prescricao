# prescricao

Gerador de prescrição pediátrica que sobrepõe nome do paciente e medicações calculadas por peso sobre um modelo de papel timbrado existente (`Consultorio.pdf`).

**Live:** https://marcelosilva2604.github.io/prescricao/

## Features

- Formulário com nome, peso e idade (opcional) do paciente
- Catálogo pesquisável de medicações em `medicacoes.json`
- Cálculo automático: `dose total = peso × mg/kg/dia`, dividido pela frequência, convertido em ml pela concentração
- Modal de primeira utilização: confirma/edita dose, frequência, duração e dose máxima por medicamento (apenas na prescrição atual; não altera o catálogo)
- Modal de dose máxima excedida com opções "usar dose máxima", "manter dose calculada" ou "cancelar"
- Pré-visualização ao vivo em HTML usando a mesma fonte (Bickham Script Pro 3)
- Geração de PDF cliente-side via `pdf-lib`, mantendo cabeçalho, marca d'água, assinatura e rodapé do template
- Paginação automática quando o conteúdo excede a zona útil (nome do paciente só na página 1; numeração contínua de medicamentos)
- Download com filename `prescricao_{nome}_{YYYY-MM-DD}.pdf`

## Arquitetura

A app **não gera o PDF do zero**. Ela carrega `Consultorio.pdf` (que já contém timbrado, marca d'água do dinossauro, carimbo de assinatura e rodapé), embute a fonte Bickham Script Pro 3 com `pdf-lib + @pdf-lib/fontkit`, e desenha por cima:

- Página 1: nome do paciente em `(x=60, y=680)`, fonte 24pt
- Cabeçalhos de via ("Uso Oral", "Uso Inalatório") em 18pt sublinhado
- Cada medicamento: linha 1 (numeração + nome + apresentação + traços) em 16pt; linha 2 indentada com volume/dose, via, frequência e duração
- Páginas extras duplicam o template via `copyPages`; o cabeçalho de via é repetido com "(cont.)" para preservar contexto

Zona segura de overlay: `x: 60–535`, `y: 250–700` (acima da assinatura, abaixo do cabeçalho).

## Editar o catálogo de medicações

Edite `medicacoes.json`. Cada entrada:

```json
{
  "id": "identificador_unico",
  "name": "Nome do medicamento",
  "presentation": "250mg/5ml suspensão oral",
  "concentration_mg_per_ml": 50,
  "dose_mg_per_kg_per_day": 50,
  "doses_per_day": 3,
  "max_mg_per_day": 1500,
  "default_duration_days": 10,
  "route": "Oral",
  "category": "Antibiótico",
  "fixed_dose": false
}
```

Para medicamentos com dose fixa (sprays, soro inalatório), use:

```json
{
  "id": "...",
  "name": "...",
  "presentation": "...",
  "fixed_dose": true,
  "fixed_dose_string": "1-2 jatos",
  "doses_per_day": 4,
  "default_duration_days": 5,
  "route": "Inalatório",
  "category": "Broncodilatador"
}
```

Omita `dose_mg_per_kg_per_day`, `concentration_mg_per_ml` e `max_mg_per_day` quando `fixed_dose: true`.

## Substituir o template do PDF

Substitua `Consultorio.pdf` por outro A4 portrait com as zonas vazias na faixa `y: 250–700`. Se as áreas ocupadas (cabeçalho, assinatura, rodapé) tiverem outras coordenadas, ajuste as constantes `ZONE` e `LAYOUT` em `pdf-overlay.js`.

## Teste local

Os recursos `Consultorio.pdf` e `BickhamScriptPro3-Regular.otf` são carregados via `fetch`, que não funciona com `file://` por restrições de CORS dos navegadores. Para testar localmente, rode um servidor estático:

```bash
cd prescricao
python3 -m http.server 8000
# acesse http://localhost:8000
```

Ou use o site publicado em https://marcelosilva2604.github.io/prescricao/.

## Limitações conhecidas

- Bickham Script Pro 3 é uma fonte caligráfica — números e símbolos podem ter aparência menos legível que fontes serifadas; valide visualmente antes de uso clínico
- Algumas features OpenType (ligaduras, swashes) podem não renderizar — pdf-lib + fontkit embute glifos sem features avançadas
- As coordenadas de zona segura foram definidas a partir do spec; se algum overlay pisar no template, ajuste `ZONE` e `LAYOUT` em `pdf-overlay.js`
- Sem persistência: ao recarregar a página, formulário e medicações adicionadas são perdidos
- O catálogo seed contém 11 medicamentos básicos; expanda editando `medicacoes.json`
- Pré-visualização HTML aproxima o PDF — não é pixel-perfect (larguras de glifo variam entre HTML rendering e pdf-lib)

## Tech stack

- HTML5 + CSS3 + JavaScript ES6+ vanilla
- [`pdf-lib`](https://pdf-lib.js.org/) 1.17.1 — manipulação de PDF cliente-side
- [`@pdf-lib/fontkit`](https://github.com/Hopding/fontkit) 1.1.1 — embed de fontes OpenType customizadas
- Bickham Script Pro 3 (`BickhamScriptPro3-Regular.otf`) — overlay e preview
- Sem framework, sem build step, sem transpiler
- Hospedado em GitHub Pages (estático)

## Privacidade / LGPD

- **Stateless**: nenhum dado de paciente é gravado em `localStorage`, `sessionStorage`, cookies ou enviado para qualquer servidor
- Todo cálculo e geração de PDF acontece no navegador do usuário
- O PDF gerado é baixado diretamente para o disco local
- Recarregar a página apaga toda informação inserida
- Não há autenticação, telemetria, analytics ou tracking de qualquer tipo
