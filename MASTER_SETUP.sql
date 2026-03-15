-- ================================================================
-- INSAN  —  MASTER SETUP SQL  v6
-- ================================================================
-- Run this ONCE on a fresh Supabase project.
-- Re-running on existing project is also safe (idempotent).
--
-- Features covered:
--   • Auth + profiles
--   • Direct messages (chats / chat_members / messages)
--   • Channels       (channels / channel_members / channel_messages)
--   • Groups         (groups / group_members / group_messages)
--   • Emoji reactions (message_reactions)
--   • Blocked users
--   • Flow posts feed (flow_posts / flow_likes / flow_comments)
--   • Storage bucket (avatars, voice, attachments, flow)
--   • Realtime publications
--   • All RLS policies + helper functions
--
-- ⚠  AFTER RUNNING THIS SQL:
--   Set CORS on the "avatars" storage bucket
--     Storage → avatars → Settings → CORS:
--       Allowed origins : *
--       Allowed methods : GET, HEAD, OPTIONS
--       Allowed headers : *
--       Max age         : 3600
-- ================================================================


-- ================================================================
-- 1.  EXTENSIONS
-- ================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ================================================================
-- 2.  TABLES
-- ================================================================

-- ── profiles ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username     text        UNIQUE NOT NULL,
  display_name text,
  avatar_url   text,
  bio          text,
  last_seen    timestamptz DEFAULT now(),
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url   text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio          text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen    timestamptz DEFAULT now();


-- ── chats ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chats (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now()
);


-- ── chat_members ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_members (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id)    ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  UNIQUE(chat_id, user_id)
);


-- ── messages ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    uuid        NOT NULL REFERENCES public.chats(id)    ON DELETE CASCADE,
  sender_id  uuid                 REFERENCES public.profiles(id) ON DELETE SET NULL,
  content    text        NOT NULL,
  created_at timestamptz DEFAULT now()
);


-- ── channels ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channels (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  avatar_url  text,
  created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS avatar_url  text;


-- ── channel_members ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid        NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member',
  joined_at  timestamptz DEFAULT now(),
  UNIQUE(channel_id, user_id)
);


-- ── channel_messages ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channel_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid        NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  sender_id  uuid                 REFERENCES public.profiles(id) ON DELETE SET NULL,
  content    text        NOT NULL,
  created_at timestamptz DEFAULT now()
);


-- ── groups ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  avatar_url  text,
  created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS avatar_url  text;


-- ── group_members ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_members (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  uuid        NOT NULL REFERENCES public.groups(id)   ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role      text        NOT NULL DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);


-- ── group_messages ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid        NOT NULL REFERENCES public.groups(id)   ON DELETE CASCADE,
  sender_id  uuid                 REFERENCES public.profiles(id) ON DELETE SET NULL,
  content    text        NOT NULL,
  created_at timestamptz DEFAULT now()
);


-- ── blocked_users ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blocked_users (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(blocker_id, blocked_id)
);


-- ── message_reactions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id text        NOT NULL,
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji      text        NOT NULL,
  conv_type  text        NOT NULL DEFAULT 'chat',
  conv_id    text        NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
ALTER TABLE public.message_reactions ADD COLUMN IF NOT EXISTS conv_type text NOT NULL DEFAULT 'chat';
ALTER TABLE public.message_reactions ADD COLUMN IF NOT EXISTS conv_id   text NOT NULL DEFAULT '';


-- ── flow_posts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flow_posts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text_content   text,
  media_url      text,
  media_type     text,
  likes_count    integer     NOT NULL DEFAULT 0,
  comments_count integer     NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT flow_posts_has_content CHECK (
    text_content IS NOT NULL OR media_url IS NOT NULL
  )
);


-- ── flow_likes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flow_likes (
  post_id    uuid NOT NULL REFERENCES public.flow_posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);


-- ── flow_comments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flow_comments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid        NOT NULL REFERENCES public.flow_posts(id)  ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  content    text        NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT flow_comments_not_empty CHECK (char_length(trim(content)) > 0)
);


-- ================================================================
-- 3.  INDEXES
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_messages_chat_id        ON public.messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id      ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at     ON public.messages(created_at);

CREATE INDEX IF NOT EXISTS idx_chat_members_user_id    ON public.chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id    ON public.chat_members(chat_id);

CREATE INDEX IF NOT EXISTS idx_ch_msgs_channel_id      ON public.channel_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_ch_msgs_sender_id       ON public.channel_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_ch_msgs_created_at      ON public.channel_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_ch_members_user_id      ON public.channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_ch_members_channel_id   ON public.channel_members(channel_id);

CREATE INDEX IF NOT EXISTS idx_grp_msgs_group_id       ON public.group_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_grp_msgs_sender_id      ON public.group_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_grp_msgs_created_at     ON public.group_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_grp_members_user_id     ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_grp_members_group_id    ON public.group_members(group_id);

CREATE INDEX IF NOT EXISTS idx_reactions_conv          ON public.message_reactions(conv_id, conv_type);
CREATE INDEX IF NOT EXISTS idx_reactions_message       ON public.message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user          ON public.message_reactions(user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_username       ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_blocked_blocker         ON public.blocked_users(blocker_id);

-- Flow
CREATE INDEX IF NOT EXISTS idx_flow_posts_user_id      ON public.flow_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_flow_posts_created_at   ON public.flow_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_likes_post_id      ON public.flow_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_flow_likes_user_id      ON public.flow_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_flow_comments_post_id   ON public.flow_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_flow_comments_created   ON public.flow_comments(created_at);

-- ================================================================
-- 4.  ENABLE ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_posts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_likes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_comments     ENABLE ROW LEVEL SECURITY;


-- ================================================================
-- 5.  SECURITY DEFINER HELPER FUNCTIONS
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_my_chat_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT chat_id FROM public.chat_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_chat_peer_id(p_chat_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT user_id FROM public.chat_members
  WHERE chat_id = p_chat_id AND user_id <> auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_blocked_in_chat(p_chat_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (
      (blocker_id = public.get_chat_peer_id(p_chat_id) AND blocked_id = auth.uid())
      OR
      (blocker_id = auth.uid() AND blocked_id = public.get_chat_peer_id(p_chat_id))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_channel_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT channel_id FROM public.channel_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_group_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT group_id FROM public.group_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.i_am_channel_admin(p_channel_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = p_channel_id
      AND user_id    = auth.uid()
      AND role       = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.i_am_group_admin(p_group_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id  = auth.uid()
      AND role     = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_my_chat_ids()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_peer_id(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_in_chat(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_channel_ids()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_group_ids()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.i_am_channel_admin(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.i_am_group_admin(uuid)     TO authenticated;


-- ================================================================
-- 6.  DROP ALL EXISTING POLICIES  (idempotent re-run safety)
-- ================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename IN (
        'profiles','chats','chat_members','messages',
        'channels','channel_members','channel_messages',
        'groups','group_members','group_messages',
        'blocked_users','message_reactions',
        'flow_posts','flow_likes','flow_comments'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;


-- ================================================================
-- 7.  RLS POLICIES
-- ================================================================

-- ── profiles ────────────────────────────────────────────────────
CREATE POLICY "profiles: read all"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles: insert own"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: update own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles: delete own"
  ON public.profiles FOR DELETE TO authenticated
  USING (auth.uid() = id);


-- ── chats ───────────────────────────────────────────────────────
CREATE POLICY "chats: member read"
  ON public.chats FOR SELECT TO authenticated
  USING (id IN (SELECT public.get_my_chat_ids()));

CREATE POLICY "chats: authenticated create"
  ON public.chats FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "chats: member delete"
  ON public.chats FOR DELETE TO authenticated
  USING (id IN (SELECT public.get_my_chat_ids()));


-- ── chat_members ────────────────────────────────────────────────
CREATE POLICY "chat_members: member read"
  ON public.chat_members FOR SELECT TO authenticated
  USING (chat_id IN (SELECT public.get_my_chat_ids()));

CREATE POLICY "chat_members: authenticated insert"
  ON public.chat_members FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "chat_members: member delete"
  ON public.chat_members FOR DELETE TO authenticated
  USING (chat_id IN (SELECT public.get_my_chat_ids()));


-- ── messages ────────────────────────────────────────────────────
CREATE POLICY "messages: member read"
  ON public.messages FOR SELECT TO authenticated
  USING (chat_id IN (SELECT public.get_my_chat_ids()));

CREATE POLICY "messages: member send"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND chat_id IN (SELECT public.get_my_chat_ids())
    AND NOT public.is_blocked_in_chat(chat_id)
  );

CREATE POLICY "messages: sender update"
  ON public.messages FOR UPDATE TO authenticated
  USING    (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "messages: member delete"
  ON public.messages FOR DELETE TO authenticated
  USING (chat_id IN (SELECT public.get_my_chat_ids()));


-- ── channels ────────────────────────────────────────────────────
CREATE POLICY "channels: public read"
  ON public.channels FOR SELECT TO authenticated USING (true);

CREATE POLICY "channels: authenticated create"
  ON public.channels FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "channels: admin update"
  ON public.channels FOR UPDATE TO authenticated
  USING (public.i_am_channel_admin(id));

CREATE POLICY "channels: admin delete"
  ON public.channels FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.i_am_channel_admin(id));


-- ── channel_members ─────────────────────────────────────────────
CREATE POLICY "channel_members: public read"
  ON public.channel_members FOR SELECT TO authenticated USING (true);

CREATE POLICY "channel_members: authenticated insert"
  ON public.channel_members FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "channel_members: member or admin delete"
  ON public.channel_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.i_am_channel_admin(channel_id));


-- ── channel_messages ────────────────────────────────────────────
CREATE POLICY "channel_messages: member read"
  ON public.channel_messages FOR SELECT TO authenticated
  USING (channel_id IN (SELECT public.get_my_channel_ids()));

CREATE POLICY "channel_messages: admin post"
  ON public.channel_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND public.i_am_channel_admin(channel_id)
  );

CREATE POLICY "channel_messages: sender update"
  ON public.channel_messages FOR UPDATE TO authenticated
  USING    (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "channel_messages: sender or admin delete"
  ON public.channel_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.i_am_channel_admin(channel_id));


-- ── groups ──────────────────────────────────────────────────────
CREATE POLICY "groups: public read"
  ON public.groups FOR SELECT TO authenticated USING (true);

CREATE POLICY "groups: authenticated create"
  ON public.groups FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "groups: admin update"
  ON public.groups FOR UPDATE TO authenticated
  USING (public.i_am_group_admin(id));

CREATE POLICY "groups: admin delete"
  ON public.groups FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.i_am_group_admin(id));


-- ── group_members ───────────────────────────────────────────────
CREATE POLICY "group_members: public read"
  ON public.group_members FOR SELECT TO authenticated USING (true);

CREATE POLICY "group_members: authenticated insert"
  ON public.group_members FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "group_members: member or admin delete"
  ON public.group_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.i_am_group_admin(group_id));


-- ── group_messages ──────────────────────────────────────────────
CREATE POLICY "group_messages: member read"
  ON public.group_messages FOR SELECT TO authenticated
  USING (group_id IN (SELECT public.get_my_group_ids()));

CREATE POLICY "group_messages: member post"
  ON public.group_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND group_id IN (SELECT public.get_my_group_ids())
  );

CREATE POLICY "group_messages: sender update"
  ON public.group_messages FOR UPDATE TO authenticated
  USING    (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "group_messages: sender or admin delete"
  ON public.group_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.i_am_group_admin(group_id));


-- ── blocked_users ───────────────────────────────────────────────
CREATE POLICY "blocked_users: read own"
  ON public.blocked_users FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

CREATE POLICY "blocked_users: insert own"
  ON public.blocked_users FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "blocked_users: delete own"
  ON public.blocked_users FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());


-- ── message_reactions ───────────────────────────────────────────
CREATE POLICY "reactions: read in conv"
  ON public.message_reactions FOR SELECT TO authenticated
  USING (
    (conv_type = 'chat'    AND conv_id::uuid IN (SELECT public.get_my_chat_ids()))
    OR (conv_type = 'channel' AND conv_id::uuid IN (SELECT public.get_my_channel_ids()))
    OR (conv_type = 'group'   AND conv_id::uuid IN (SELECT public.get_my_group_ids()))
  );

CREATE POLICY "reactions: insert own"
  ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reactions: update own"
  ON public.message_reactions FOR UPDATE TO authenticated
  USING    (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reactions: delete own"
  ON public.message_reactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ── flow_posts ──────────────────────────────────────────────────
CREATE POLICY "flow_posts: public read"
  ON public.flow_posts FOR SELECT TO authenticated USING (true);

CREATE POLICY "flow_posts: authenticated insert"
  ON public.flow_posts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "flow_posts: owner update"
  ON public.flow_posts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "flow_posts: owner delete"
  ON public.flow_posts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ── flow_likes ──────────────────────────────────────────────────
CREATE POLICY "flow_likes: public read"
  ON public.flow_likes FOR SELECT TO authenticated USING (true);

CREATE POLICY "flow_likes: own insert"
  ON public.flow_likes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "flow_likes: own delete"
  ON public.flow_likes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ── flow_comments ───────────────────────────────────────────────
CREATE POLICY "flow_comments: public read"
  ON public.flow_comments FOR SELECT TO authenticated USING (true);

CREATE POLICY "flow_comments: own insert"
  ON public.flow_comments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "flow_comments: own or post-owner delete"
  ON public.flow_comments FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() IN (
      SELECT user_id FROM public.flow_posts WHERE id = post_id
    )
  );



-- ================================================================
-- 8.  REALTIME
-- ================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'messages',
    'channel_messages',
    'group_messages',
    'message_reactions',
    'flow_posts',
    'flow_comments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.' || t;
    END IF;
  END LOOP;
END $$;


-- ================================================================
-- 9.  STORAGE BUCKET
-- ================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'avatars_public_read','avatars_auth_upload',
        'avatars_auth_update','avatars_auth_delete'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_auth_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "avatars_auth_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "avatars_auth_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');


-- ================================================================
-- ALL DONE  ✓
--
-- TABLES (16):
--   profiles            — user accounts & settings
--   chats               — DM conversation containers
--   chat_members        — DM participants (2 per chat)
--   messages            — DM messages (text/file/voice/image)
--   channels            — broadcast channels
--   channel_members     — channel memberships + roles
--   channel_messages    — channel messages
--   groups              — group chats
--   group_members       — group memberships + roles
--   group_messages      — group messages
--   blocked_users       — per-user block list
--   message_reactions   — emoji reactions (all conv types)
--   flow_posts          — public posts feed
--   flow_likes          — likes on flow posts
--   flow_comments       — comments on flow posts
--
-- REALTIME: messages, channel_messages, group_messages,
--           message_reactions, flow_posts, flow_comments
--
-- STORAGE bucket "avatars":
--   avatars/       — profile + channel/group photos
--   voice/         — voice recordings
--   attachments/   — file/image/video in chats
--   flow/          — flow post media
--
-- ⚠  Set CORS on "avatars" bucket in Supabase dashboard.
-- ⚠  Complete the 5-step setup at the top of this file
--    to enable background call push notifications.
-- ================================================================
