-- Dati sintetici precedenti alla migrazione: anche gli altri provider devono sopravvivere.
INSERT INTO public.cron_settings (schedule_key) VALUES ('other-job');
INSERT INTO public.users(id, email)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'migration-owner@example.invalid');
INSERT INTO public.user_provider_credentials(id, user_id, provider, encrypted_key, is_configured) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000001', 'firecrawl', 'old-key', TRUE),
  ('aaaaaaaa-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000001', 'youtube', 'keep-key', TRUE),
  ('aaaaaaaa-0000-4000-8000-000000000013', 'aaaaaaaa-0000-4000-8000-000000000001', 'gemini', 'keep-key', TRUE);
INSERT INTO public.credential_checks(credential_id, is_valid)
VALUES ('aaaaaaaa-0000-4000-8000-000000000011', TRUE);
INSERT INTO public.api_usage_events(id, user_id, provider, operation, outcome) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000001', 'firecrawl', 'test', 'success'),
  ('aaaaaaaa-0000-4000-8000-000000000022', 'aaaaaaaa-0000-4000-8000-000000000001', 'youtube', 'videos.list', 'success');
INSERT INTO public.jobs(id, job_type, status, payload, created_by_user_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000031', 'validate_provider_credential', 'pending',
   jsonb_build_object('provider', 'firecrawl', 'credentialId', 'aaaaaaaa-0000-4000-8000-000000000011'),
   'aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000032', 'sync_channel_delta', 'pending', '{}',
   'aaaaaaaa-0000-4000-8000-000000000001');
INSERT INTO public.job_attempts(id, job_id, attempt_number, status) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000031', 1, 'failed');
INSERT INTO public.channels(id, youtube_channel_id, title)
VALUES ('aaaaaaaa-0000-4000-8000-000000000051', 'UC-migration-fixture', 'Migration fixture');
INSERT INTO public.channel_scan_key_rotation_cursors(channel_id, provider, last_credential_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000051', 'firecrawl', 'aaaaaaaa-0000-4000-8000-000000000011'),
  ('aaaaaaaa-0000-4000-8000-000000000051', 'youtube', 'aaaaaaaa-0000-4000-8000-000000000012');
INSERT INTO public.channel_scan_job_credentials(job_id, provider, credential_id, key_version, status) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000032', 'firecrawl', 'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000061', 'active'),
  ('aaaaaaaa-0000-4000-8000-000000000032', 'youtube', 'aaaaaaaa-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000062', 'active');
INSERT INTO public.channel_scan_provider_requests(job_id, request_key, provider) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000032', repeat('a', 64), 'firecrawl'),
  ('aaaaaaaa-0000-4000-8000-000000000032', repeat('b', 64), 'youtube');
INSERT INTO public.channel_scan_provider_attempts(job_id, request_key, credential_id, key_version, retry_limit, last_outcome) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000032', repeat('a', 64), 'aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000061', 0, 'started');
