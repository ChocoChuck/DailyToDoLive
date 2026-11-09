"""One-time optional migration: SQLite tracker.db -> SQL for Supabase SQL Editor.
Usage: python3 import_sqlite.py /path/to/tracker.db YOUR_SUPABASE_AUTH_USER_UUID
Creates a local import-tracker.sql file. Does not edit the SQLite database.
Run the generated SQL in Supabase SQL Editor after schema.sql.
"""
import sqlite3
import sys
import uuid
from pathlib import Path

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def run():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python3 import_sqlite.py tracker.db YOUR_SUPABASE_AUTH_USER_UUID')
    db_path = Path(sys.argv[1]).expanduser().resolve()
    uid = str(uuid.UUID(sys.argv[2]))
    connection = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    goals = connection.execute('select id, name, created_on, archived_on from goals order by id').fetchall()
    entries = connection.execute('select day, task_id, completed, note from entries order by day, task_id').fetchall()
    settings = {r['key']: r['value'] for r in connection.execute('select key,value from settings')}
    if not goals:
        raise SystemExit('No goals found. This importer requires tracker version 3 with goals table.')
    goal_map = {r['id']: str(uuid.uuid4()) for r in goals}
    unknown = {e['task_id'] for e in entries} - goal_map.keys()
    if unknown:
        raise SystemExit(f'Entries reference missing goal IDs: {sorted(unknown)}')
    sql = [
        '-- ONE-TIME IMPORT. Run schema.sql first and sign up / verify your account.',
        '-- REVIEW THE TARGET UUID AND SQL BEFORE RUNNING. Do not publish this file.',
        'begin;',
        f"do $$ begin if not exists (select 1 from auth.users where id = '{uid}'::uuid) then raise exception 'Target user does not exist'; end if; end $$;",
        '-- Keep this script from being accidentally run again by requiring an untouched seeded tracker.',
        f"do $$ begin if exists (select 1 from public.tracker_entries where user_id = '{uid}') then raise exception 'Target already has entries. Import into a fresh tracker account.'; end if; end $$;",
        f"do $$ begin if (select count(*) from public.tracker_goals where user_id = '{uid}') <> 5 then raise exception 'Target goal list has changed. Import into a fresh tracker account.'; end if; end $$;",
        f"delete from public.tracker_goals where user_id = '{uid}';"
    ]
    for g in goals:
        archived = 'null' if g['archived_on'] is None else quote(g['archived_on'])+'::date'
        sql.append(f"insert into public.tracker_goals(id,user_id,name,created_on,archived_on) values ('{goal_map[g['id']]}','{uid}',{quote(g['name'])},{quote(g['created_on'])}::date,{archived});")
    for e in entries:
        completed='true' if e['completed'] else 'false'
        sql.append(f"insert into public.tracker_entries(user_id,goal_id,day,completed,note) values ('{uid}','{goal_map[e['task_id']]}',{quote(e['day'])}::date,{completed},{quote(e['note'] or '')});")
    start = settings.get('started_on')
    if start:
        sql.append(f"update public.tracker_profiles set started_on = least(started_on,{quote(start)}::date) where user_id = '{uid}';")
    sql.append('commit;')
    out=Path('import-tracker.sql')
    out.write_text('\n'.join(sql)+'\n', encoding='utf-8')
    print(f'Wrote {out.resolve()} ({len(goals)} goals, {len(entries)} entries).')
    print('Review the file before running it in Supabase SQL Editor. Keep it private.')
if __name__=='__main__':
    run()
