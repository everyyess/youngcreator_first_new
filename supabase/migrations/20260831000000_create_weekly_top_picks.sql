-- 삼성증권 "주간 투자 전략" 리포트에서 추출한 TOP PICK 종목 리스트.
-- 고객별 자산이 아니라 전사 공용 리서치 자료이므로 PB 구분 없이 하나의 최신 세트만 유지한다.
-- 새 리포트를 업로드하면 기존 행을 모두 지우고 새로 insert한다 (덮어쓰기 방식).

create table if not exists public.weekly_top_picks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  recommended_date text,
  return_pct numeric,
  thesis text,
  is_new boolean not null default false,
  is_non_coverage boolean not null default false,
  sort_order integer not null default 0,
  uploaded_at timestamptz not null default now()
);

create index if not exists weekly_top_picks_uploaded_at_idx
  on public.weekly_top_picks(uploaded_at desc);

alter table public.weekly_top_picks enable row level security;

-- 모든 로그인 사용자(PB·고객)가 최신 추천 종목을 조회할 수 있다.
drop policy if exists "weekly_top_picks_select_all" on public.weekly_top_picks;
create policy "weekly_top_picks_select_all"
on public.weekly_top_picks
for select
to authenticated, anon
using (true);

-- insert/update/delete는 서버 API 라우트가 service role 키로 수행하며 RLS를 우회한다.
