# Gestão Académica Pro — Versão Supabase

## O que mudou em relação à versão anterior

- **Dados deixam de ficar no `localStorage`** — agora vivem num projecto Supabase (Postgres), acessíveis de qualquer dispositivo.
- **Autenticação real** via Supabase Auth (email + senha), substituindo o hash fraco de senhas usado antes.
- **Ficheiros/materiais** guardados no Supabase Storage (bucket privado `materiais`), com limite de 20MB por ficheiro.
- **Funcionalidade de backup manual removida** — os dados já estão persistentes e seguros no servidor (podes sempre exportar via SQL/Backups automáticos do próprio Supabase).
- **Novo: apagar semestre** — com confirmação reforçada quando já tem notas lançadas.
- **Novo: Comunidade** — pesquisa de estudantes por nome/número/curso, perfil (curso + ano) e troca de mensagens em tempo real.
- **Bugs corrigidos**: eliminação em cascata correcta ao apagar disciplina/semestre (materiais e apontamentos deixam de ficar órfãos), validação de tamanho de ficheiro, isolamento de dados por utilizador via Row Level Security (RLS) em vez de tudo partilhado num único blob no browser.

## Passo 1 — Criar o projecto Supabase

1. Cria uma conta em [supabase.com](https://supabase.com) e cria um novo projecto.
2. Vai a **SQL Editor** → **New query**, cola o conteúdo de `schema.sql` e executa (**Run**). Isto cria todas as tabelas, políticas de segurança (RLS), o bucket de armazenamento `materiais` e o trigger que cria o perfil automaticamente no registo.
3. Em **Authentication → Providers → Email**, confirma se queres exigir confirmação de email:
   - Se desativares "Confirm email", o registo entra logo na app.
   - Se mantiveres activo, o utilizador tem de confirmar o email antes do primeiro login (a app já trata esse caso).

## Passo 2 — Configurar a aplicação

Abre `config.js` e substitui pelos valores do teu projecto (**Project Settings → API**):

```js
const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "SUA-CHAVE-ANON-PUBLICA";
```

A chave "anon" é pública por design (protegida pelas políticas RLS) — não precisa de ser secreta.

## Passo 3 — Publicar

Os 3 ficheiros (`index.html`, `config.js`, `app.js`) são estáticos — não há build. Podes:

- Abrir `index.html` directamente, ou
- Publicar numa hospedagem estática (Vercel, Netlify, GitHub Pages, ou o teu próprio `klay-systems.vercel.app`).

## Notas importantes

- **Número de estudante único**: se o registo falhar com um erro genérico, o motivo mais comum é o número de estudante já estar em uso (a validação acontece na base de dados via um trigger).
- **Limite de ficheiros**: 20MB por ficheiro (configurável em `TAMANHO_MAX_FICHEIRO` no `app.js`). Ficheiros maiores são recusados no cliente antes do envio.
- **Mensagens em tempo real**: usam o Supabase Realtime; não precisas de configurar nada extra além do que já está no `schema.sql` (`alter publication supabase_realtime add table public.mensagens`).
- **Migração de dados antigos**: se quiseres importar os dados do teu backup JSON antigo (`gestao_academica_backup_...json`) para o Supabase, isso implica um script à parte (mapear IDs antigos para os novos, gerar contas de utilizador, etc.) — diz-me se queres que eu o prepare.
