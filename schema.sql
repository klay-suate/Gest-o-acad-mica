-- ══════════════════════════════════════════════════════════════
-- GESTÃO ACADÉMICA PRO — Schema Supabase
-- Executa este ficheiro completo no SQL Editor do teu projecto Supabase
-- (Project > SQL Editor > New query > cola tudo > Run)
-- ══════════════════════════════════════════════════════════════

-- ─── EXTENSÕES ───
create extension if not exists "pgcrypto";

-- ══════════════════════════════════════════════════════════════
-- PERFIS (estende auth.users)
-- ══════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  numero text not null unique,
  curso text not null default '',
  ano int,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Qualquer utilizador autenticado pode pesquisar/ver perfis (nome, número, curso, ano)
-- — necessário para a funcionalidade social de pesquisa de estudantes.
create policy "profiles: leitura pública para autenticados"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles: cada um só edita o seu"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

create policy "profiles: cada um só cria o seu (no registo)"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- Cria automaticamente o perfil quando alguém se regista (dados vêm de
-- supabase.auth.signUp({..., options:{data:{nome,numero,curso,ano}}}))
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nome, numero, curso, ano)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(new.raw_user_meta_data->>'numero', new.id::text),
    coalesce(new.raw_user_meta_data->>'curso', ''),
    nullif(new.raw_user_meta_data->>'ano','')::int
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ══════════════════════════════════════════════════════════════
-- SEMESTRES
-- ══════════════════════════════════════════════════════════════
create table if not exists public.semestres (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ano int not null,
  numero int not null check (numero in (1,2)),
  created_at timestamptz not null default now()
);
alter table public.semestres enable row level security;
create policy "semestres: dono" on public.semestres for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- DISCIPLINAS
-- ══════════════════════════════════════════════════════════════
create table if not exists public.disciplinas (
  id bigint generated always as identity primary key,
  semestre_id bigint not null references public.semestres(id) on delete cascade,
  nome text not null,
  docente text default '—',
  teste1 numeric,
  teste2 numeric,
  trabalho numeric,
  nota_exame numeric,
  created_at timestamptz not null default now()
);
alter table public.disciplinas enable row level security;
create policy "disciplinas: dono via semestre" on public.disciplinas for all
  to authenticated
  using (exists (select 1 from public.semestres s where s.id = semestre_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.semestres s where s.id = semestre_id and s.user_id = auth.uid()));

-- ══════════════════════════════════════════════════════════════
-- PLANOS DE DISCIPLINA
-- ══════════════════════════════════════════════════════════════
create table if not exists public.planos (
  id bigint generated always as identity primary key,
  disciplina_id bigint not null unique references public.disciplinas(id) on delete cascade,
  objectivos text,
  conteudos text,
  metodologia text,
  bibliografia text
);
alter table public.planos enable row level security;
create policy "planos: dono via disciplina/semestre" on public.planos for all
  to authenticated
  using (exists (select 1 from public.disciplinas d join public.semestres s on s.id=d.semestre_id where d.id = disciplina_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.disciplinas d join public.semestres s on s.id=d.semestre_id where d.id = disciplina_id and s.user_id = auth.uid()));

-- ══════════════════════════════════════════════════════════════
-- HORÁRIOS
-- ══════════════════════════════════════════════════════════════
create table if not exists public.horarios (
  id bigint generated always as identity primary key,
  disciplina_id bigint not null references public.disciplinas(id) on delete cascade,
  dia_semana text not null,
  hora_inicio text not null,
  hora_fim text not null,
  sala text default ''
);
alter table public.horarios enable row level security;
create policy "horarios: dono via disciplina/semestre" on public.horarios for all
  to authenticated
  using (exists (select 1 from public.disciplinas d join public.semestres s on s.id=d.semestre_id where d.id = disciplina_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.disciplinas d join public.semestres s on s.id=d.semestre_id where d.id = disciplina_id and s.user_id = auth.uid()));

-- ══════════════════════════════════════════════════════════════
-- MATERIAIS (metadados — ficheiros ficam no Storage)
-- ══════════════════════════════════════════════════════════════
create table if not exists public.materiais (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  disciplina_id bigint references public.disciplinas(id) on delete set null,
  nome text not null,
  descricao text default '',
  ext text not null,
  tamanho bigint not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
alter table public.materiais enable row level security;
create policy "materiais: dono" on public.materiais for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- LEMBRETES
-- ══════════════════════════════════════════════════════════════
create table if not exists public.lembretes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  disciplina_id bigint references public.disciplinas(id) on delete set null,
  nome text not null,
  data date not null,
  tipo text not null default 'Teste'
);
alter table public.lembretes enable row level security;
create policy "lembretes: dono" on public.lembretes for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- METAS
-- ══════════════════════════════════════════════════════════════
create table if not exists public.metas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  disciplina_id bigint not null references public.disciplinas(id) on delete cascade,
  objetivo numeric not null,
  unique (user_id, disciplina_id)
);
alter table public.metas enable row level security;
create policy "metas: dono" on public.metas for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- APONTAMENTOS
-- ══════════════════════════════════════════════════════════════
create table if not exists public.apontamentos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  disciplina_id bigint references public.disciplinas(id) on delete set null,
  titulo text not null,
  texto text default '',
  created_at timestamptz not null default now()
);
alter table public.apontamentos enable row level security;
create policy "apontamentos: dono" on public.apontamentos for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- COMUNIDADE — conversas e mensagens (funcionalidade nova)
-- ══════════════════════════════════════════════════════════════
create table if not exists public.conversas (
  id bigint generated always as identity primary key,
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint par_ordenado check (user_a < user_b),
  unique (user_a, user_b)
);
alter table public.conversas enable row level security;
create policy "conversas: participante" on public.conversas for select
  to authenticated using (auth.uid() in (user_a, user_b));
create policy "conversas: criar como participante" on public.conversas for insert
  to authenticated with check (auth.uid() in (user_a, user_b));

create table if not exists public.mensagens (
  id bigint generated always as identity primary key,
  conversa_id bigint not null references public.conversas(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  texto text not null,
  created_at timestamptz not null default now(),
  lida boolean not null default false
);
alter table public.mensagens enable row level security;
create policy "mensagens: participante da conversa pode ler" on public.mensagens for select
  to authenticated using (exists (select 1 from public.conversas c where c.id = conversa_id and auth.uid() in (c.user_a, c.user_b)));
create policy "mensagens: participante pode enviar" on public.mensagens for insert
  to authenticated with check (
    sender_id = auth.uid()
    and exists (select 1 from public.conversas c where c.id = conversa_id and auth.uid() in (c.user_a, c.user_b))
  );
create policy "mensagens: participante pode marcar como lida" on public.mensagens for update
  to authenticated using (exists (select 1 from public.conversas c where c.id = conversa_id and auth.uid() in (c.user_a, c.user_b)));

-- Activar Realtime nas mensagens (para chat ao vivo)
alter publication supabase_realtime add table public.mensagens;

-- ══════════════════════════════════════════════════════════════
-- STORAGE — bucket para materiais/ficheiros
-- ══════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
  values ('materiais', 'materiais', false)
  on conflict (id) do nothing;

-- Cada utilizador só acede à sua própria pasta dentro do bucket: materiais/{user_id}/...
create policy "materiais storage: dono pode tudo na sua pasta"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'materiais' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'materiais' and (storage.foldername(name))[1] = auth.uid()::text);

-- ══════════════════════════════════════════════════════════════
-- FIM
-- ══════════════════════════════════════════════════════════════
