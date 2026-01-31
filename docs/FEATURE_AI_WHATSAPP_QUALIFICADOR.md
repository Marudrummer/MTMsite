# FEATURE — IA Qualificadora de Projetos via WhatsApp + Handoff Humano

## Contexto Geral
Este projeto implementa uma nova feature no site: um fluxo de qualificação de leads usando WhatsApp com IA.
O objetivo NÃO é vender automaticamente, mas ajudar o cliente a organizar uma ideia confusa em um briefing estruturado, para então receber atendimento humano.

O site já existe e possui blog e páginas institucionais. Esta feature adiciona:
- uma nova página "Não sabe o que fazer ainda?"
- um fluxo de conversa no WhatsApp com IA
- integração com n8n para orquestração, registro e envio de briefing
- possibilidade de atendimento humano imediato a qualquer momento

## Princípios Importantes
- IA NÃO substitui humano
- IA NÃO promete preço final
- IA NÃO inventa soluções fora do catálogo
- IA pode ser interrompida a qualquer momento com a palavra "HUMANO"
- Quando HUMANO assume, a IA fica totalmente silenciosa
- WhatsApp é o canal principal de conversão
- Site é o canal de decisão e confiança

---

## UX NO SITE

### Página: "Não sabe o que fazer ainda?"
Objetivo: capturar usuários que não sabem exatamente o que precisam.

Conteúdo da página:
Título:
"Não sabe o que fazer ainda? A gente te ajuda a transformar a ideia em projeto."

Texto:
"Converse no WhatsApp e, em poucos minutos, organizamos sua necessidade em um briefing claro.
Se preferir, você também pode enviar sua ideia por formulário."

CTAs:
1) Botão principal:
"Falar no WhatsApp agora"
- abre WhatsApp via click-to-chat
- mensagem inicial predefinida

2) Botão secundário:
"Prefiro enviar minha ideia por escrito"
- abre formulário simples no site

Nota de confiança:
"Você pode falar com uma pessoa real a qualquer momento. Basta digitar HUMANO no WhatsApp."

---

## CATÁLOGO DE SERVIÇOS (FONTE DE VERDADE DA IA)

A IA só pode sugerir, classificar e trabalhar com os serviços abaixo.
Caso algo não se encaixe, a IA deve encaminhar para HUMANO.

### Serviços disponíveis:

1) Digital Signage
Descrição:
Exibição automática de vídeos e conteúdos em telas (TVs, elevadores, painéis).
Inputs:
- horário
- agenda
Outputs:
- vídeo
- áudio
Requisitos:
- tela
- player (Raspberry ou PC)
- energia
Internet: opcional
Uso comum:
- museus
- elevadores
- lojas
- empresas

2) Totem Interativo Touch
Descrição:
Totem com tela sensível ao toque para interação do público.
Inputs:
- toque na tela
Outputs:
- conteúdo visual
- navegação
Requisitos:
- tela touch
- computador
- estrutura física
Internet: opcional

3) Jogo Interativo com Botões
Descrição:
Jogo físico com botões coloridos ou temáticos conectados ao sistema.
Inputs:
- botões físicos
Outputs:
- pontuação
- feedback visual/sonoro
Requisitos:
- botões
- controlador
- tela
Internet: não obrigatória

4) Visão Computacional (Câmera)
Descrição:
Experiência interativa usando câmera (mãos, corpo, rosto).
Inputs:
- câmera
- movimento corporal
Outputs:
- reação visual
- pontuação
- imagem/vídeo
Requisitos:
- câmera
- computador
- iluminação mínima
Internet: opcional

5) RFID / Peças / Cartas
Descrição:
Interação física com peças, cartas ou objetos identificados por RFID.
Inputs:
- cartões ou peças RFID
Outputs:
- vídeos
- animações
- lógica de acerto/erro
Requisitos:
- leitores RFID
- controlador
- peças físicas
Internet: não obrigatória

6) Totem de Foto / IA / QR Code
Descrição:
Totem que tira foto, processa com IA e entrega via QR Code.
Inputs:
- câmera
- escolha de tema
Outputs:
- imagem final
- QR Code
Requisitos:
- câmera
- computador
- tela
Internet: recomendada

7) Automação de Áudio e Vídeo
Descrição:
Sistema automático de reprodução de áudio/vídeo em ambientes.
Inputs:
- agenda
- sensores (opcional)
Outputs:
- som ambiente
- vídeo contínuo
Requisitos:
- players
- caixas de som
- telas
Internet: opcional

8) Dashboard / Painel de Controle
Descrição:
Interface web para gerenciar conteúdos, jogos ou dados.
Inputs:
- usuários
- formulários
Outputs:
- relatórios
- controle remoto
Requisitos:
- navegador
- servidor
Internet: obrigatória

9) Integrações e Sistemas Customizados
Descrição:
Integrações entre sistemas, APIs, sensores e painéis.
Inputs:
- APIs
- sensores
Outputs:
- dados
- automações
Requisitos:
- definição técnica
Internet: geralmente obrigatória

---

## JORNADA NO WHATSAPP (IA)

Mensagem inicial:
"Oi! 👋
Eu posso te ajudar a organizar sua ideia e preparar um briefing rápido.
Se quiser falar com uma pessoa agora, escreva HUMANO a qualquer momento."

Fluxo máximo:
- 5 a 7 mensagens

Perguntas base:
1) "Em uma frase: o que você quer criar?"
2) "Onde isso vai ser usado? (museu, evento, loja, empresa, outro)"
3) "É para interação do público ou apenas exibição?"
4) "Como a pessoa interage? (toque, botões, câmera, RFID, nenhuma)"
5) "Você já tem tela/computador no local?"
6) "Existe internet no local?"
7) "É compra ou locação?"
8) "Se for locação: quantos dias e quais datas do evento?"
9) "Qual é o local e a cidade?"

Encerramento IA:
"Perfeito. Vou organizar tudo em um briefing e alguém do time humano entra em contato com você."

---

## COMANDO HUMANO (HANDOFF)

Trigger:
- Mensagem contendo:
  HUMANO
  PESSOA
  ATENDENTE
  FALAR COM ALGUÉM

Ação imediata:
1) IA responde:
"Perfeito 😊 Vou chamar alguém do time agora."
2) Status do lead muda para HUMAN_ACTIVE
3) IA fica completamente silenciosa
4) Atendimento passa a ser manual no WhatsApp

---

## ESTADOS DO LEAD

- AI_QUALIFYING
- WAITING_CONTACT
- HUMAN_ACTIVE
- BRIEFING_READY
- DONE
- SPAM_BLOCKED

Regra crítica:
Se status = HUMAN_ACTIVE → nenhuma resposta automática pode ser enviada.

---

## BRIEFING GERADO (FORMATO PADRÃO)

O briefing deve ser gerado em texto + JSON.

Campos:
- Objetivo do projeto
- Tipo de serviço (do catálogo)
- Contexto de uso
- Forma de interação
- Infraestrutura existente
- Requisitos técnicos
- Compra ou locação
- Duração e datas do evento (se locação)
- Prazo
- Cidade
- Sugestão de 2 ou 3 caminhos possíveis
- Observações

---

## INTEGRAÇÃO COM N8N

O n8n é o orquestrador do sistema.

Funções do n8n:
- receber dados do site (formulário)
- receber dados do WhatsApp
- salvar lead (planilha ou banco)
- gerar briefing
- enviar e-mail interno
- notificar humano quando HUMANO for solicitado

Payload padrão para n8n:
{
  "channel": "whatsapp | site_form",
  "phone": "",
  "name": "",
  "email": "",
  "city": "",
  "answers": {},
  "summary": "",
  "status": ""
}

---

## REGRAS DA IA (ANTI-ALUCINAÇÃO)

A IA DEVE:
- trabalhar apenas com o catálogo definido
- fazer no máximo 7 perguntas
- ser objetiva
- confirmar entendimento
- encaminhar para HUMANO em caso de dúvida técnica

A IA NÃO DEVE:
- prometer preço fechado
- inventar serviços
- continuar respondendo após HUMANO
- falar como vendedor agressivo

---

## CRITÉRIOS DE SUCESSO

- Site apresenta claramente a opção de conversa no WhatsApp
- Usuário entende que há IA + humano
- Briefing chega estruturado
- Atendimento humano assume sem conflito
- Sistema registra histórico
- IA reduz tempo humano, não cria fricção

---

## VISÃO FUTURA (NÃO IMPLEMENTAR AGORA)
- Base de conhecimento (RAG)
- Histórico de projetos
- Sugestão automática de faixas de orçamento
- Dashboard de leads
