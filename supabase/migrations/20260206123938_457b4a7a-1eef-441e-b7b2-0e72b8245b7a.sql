
-- Chat messages table
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  message text NOT NULL,
  mentions uuid[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view messages"
ON public.chat_messages FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can insert messages"
ON public.chat_messages FOR INSERT
WITH CHECK (true);

-- Index for ordering
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at DESC);

-- Chat read status per user
CREATE TABLE public.chat_read_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.chat_read_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own read status"
ON public.chat_read_status FOR SELECT
USING (true);

CREATE POLICY "Users can manage their own read status"
ON public.chat_read_status FOR ALL
USING (true)
WITH CHECK (true);

-- Enable realtime for chat messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
