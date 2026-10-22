-- restore-drill-erasure.sql - step "apply erasure_log" of the restore drill (D-011, D-028). Run on the RESTORED database.
-- erasure_log does not exist yet (D-050: it arrives with the M3 admin or Phase 2). Until it does, this prints a notice and passes.
-- Once the table exists, the migration that creates it MUST also create app.reapply_erasure_log(); a table without that function
-- fails the drill, because a restore would then bring erased people back.
do $$
begin
  if to_regclass('public.erasure_log') is null then
    raise notice 'erasure_log is not built yet (D-050): nothing to re-apply';
  elsif to_regprocedure('app.reapply_erasure_log()') is null then
    raise exception 'ASSERT FAIL: public.erasure_log exists but app.reapply_erasure_log() does not: a restore cannot re-apply erasures';
  else
    execute 'select app.reapply_erasure_log()';
    raise notice 'erasure_log re-applied';
  end if;
end
$$;

select 'ok: erasure step done' as result;
