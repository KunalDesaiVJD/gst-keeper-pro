-- Builder module: client-level default for metro / non-metro.
--
-- Metro status is what decides the affordable-housing carpet limit (60 sq m
-- metro, 90 sq m elsewhere) and is set per project, since one builder client
-- could in principle run projects in more than one city. In practice every
-- one of this firm's clients builds on Gujarat property, and no Gujarat city
-- is on the metro list (Bengaluru, Chennai, Delhi NCR, Hyderabad, Kolkata,
-- MMR) — so every new project for a given client is, almost always, the same
-- answer. This column lets that answer be set once at client setup and
-- carried onto every new project automatically, instead of re-selected by
-- hand each time. It only supplies a default: an existing project's own
-- election is never touched by changing this later.

alter table public.builder_client_settings
  add column if not exists default_is_metro boolean not null default false;

comment on column public.builder_client_settings.default_is_metro is
  'Default metro/non-metro for a NEW project created for this client — carried onto '
  'BuilderProjectSettingsDialog''s create form. Does not affect any existing project.';
