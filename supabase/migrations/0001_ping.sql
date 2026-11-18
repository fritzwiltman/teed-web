-- Keep-alive target for the scheduled GitHub Action.
create or replace function public.ping() returns int language sql stable as 'select 1';
grant execute on function public.ping() to anon;
