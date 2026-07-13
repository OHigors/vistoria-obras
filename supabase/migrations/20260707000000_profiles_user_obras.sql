-- Perfis por usuário + relação usuário↔obra(s). Base para o multi-obra:
-- cada usuário tem um profile (1:1 com auth.users) e acessa uma ou mais obras
-- via user_obras. Por enquanto a RLS das tabelas de dados continua
-- "authenticated vê tudo" (a escolha da obra é feita no app); o escopo por obra
-- via user_obras é o próximo passo de segurança (Fase 2b).

-- ── profiles (1:1 com auth.users) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── user_obras (obras que cada usuário acessa) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_obras (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  obra_id    uuid NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, obra_id)
);
ALTER TABLE public.user_obras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_obras_self_select ON public.user_obras;
CREATE POLICY user_obras_self_select ON public.user_obras
  FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.user_obras TO authenticated;

-- ── cria o profile automaticamente quando um usuário é criado ─────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── backfill: profiles p/ usuários existentes ─────────────────────────────────
INSERT INTO public.profiles (id, email, name)
SELECT id, email, COALESCE(raw_user_meta_data->>'name', email)
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Setup inicial: dá a cada usuário existente acesso a cada obra existente
-- (admin). Novos usuários NÃO recebem obras automaticamente — a atribuição é
-- feita por um admin (dashboard / futura tela).
INSERT INTO public.user_obras (user_id, obra_id, role)
SELECT p.id, o.id, 'admin'
FROM public.profiles p CROSS JOIN public.obras o
ON CONFLICT DO NOTHING;

-- handle_new_user é trigger (SECURITY DEFINER) — não deve ser chamável via RPC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
