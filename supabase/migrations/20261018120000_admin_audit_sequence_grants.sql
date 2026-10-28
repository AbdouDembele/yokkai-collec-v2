begin;

-- IDENTITY allocation for policy-checked admin INSERTs does not require sequence
-- privileges. Admin RPCs run as their SECURITY DEFINER owner; service_role keeps
-- its existing grants. Players must not call nextval/setval or read this sequence.
revoke all on sequence public.admin_audit_logs_id_seq from public, anon, authenticated;

commit;
