
-- Audit log table for Clear Data actions
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_role TEXT NOT NULL,
  client_id UUID,
  client_name TEXT,
  module TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'clear_data',
  financial_year TEXT,
  records_deleted INTEGER DEFAULT 0,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view audit logs" ON public.audit_log
  FOR SELECT USING (true);

CREATE POLICY "Staff can insert audit logs" ON public.audit_log
  FOR INSERT WITH CHECK (true);

-- DM Chat: chat_channels table
CREATE TABLE public.chat_channels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_type TEXT NOT NULL DEFAULT 'group' CHECK (channel_type IN ('group', 'dm')),
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view channels" ON public.chat_channels
  FOR SELECT USING (true);

CREATE POLICY "Anyone can create channels" ON public.chat_channels
  FOR INSERT WITH CHECK (true);

-- DM Chat: channel members
CREATE TABLE public.chat_channel_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view channel members" ON public.chat_channel_members
  FOR SELECT USING (true);

CREATE POLICY "Anyone can join channels" ON public.chat_channel_members
  FOR INSERT WITH CHECK (true);

-- DM Chat: channel messages
CREATE TABLE public.chat_channel_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  message TEXT NOT NULL,
  mentions UUID[] DEFAULT '{}'::uuid[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_channel_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view channel messages" ON public.chat_channel_messages
  FOR SELECT USING (true);

CREATE POLICY "Anyone can send channel messages" ON public.chat_channel_messages
  FOR INSERT WITH CHECK (true);

-- DM read status per channel
CREATE TABLE public.chat_channel_read_status (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  last_read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

ALTER TABLE public.chat_channel_read_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage their read status" ON public.chat_channel_read_status
  FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for DM messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_channel_messages;

-- Create the "Team Chat" group channel
INSERT INTO public.chat_channels (channel_type, name) VALUES ('group', 'Team Chat');
