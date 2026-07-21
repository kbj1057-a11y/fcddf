# FC Smart-Manager (FC어울림)

## Quick start
1. `.env.local` 생성 (`cp .env.local.example .env.local`)
2. Supabase 프로젝트 만들고 `players`, `attendance`, `match_quarters`, `quarter_lineups` 테이블 적용
3. `npm install`
4. `npm run dev` → http://localhost:3000

## Build
`npm run build` → `out/` 디렉토리에 정정 빌드

## Deploy
- Netlify: build command `npm run build`, publish directory `out`
- Vercel: 기본 Next.js 감지
