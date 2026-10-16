---
name: board-builder
description: GitHub API + Vercel 기반 정적 부동산 게시판 홈페이지(혁신노블부동산)를 구축·유지보수하고, 마크다운 글을 data/posts.json 게시글로 등록할 때 사용한다.
---

# board-builder

GitHub 저장소의 `data/posts.json`을 데이터베이스처럼 쓰는 정적 게시판 홈페이지. 빌드 과정 없이 Vercel zero-config로 배포한다.

## 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 메인 랜딩. `#board-preview`에 최신 글 3개, `#about`에 대표 중개사 사진(`Cho.jpg`) |
| `news.html` | 전체 목록 + 카테고리 탭 + `#search-input` 검색 + `#news-list` + 페이지네이션, lg 이상 사이드바 프로필 |
| `news-detail.html` | `?id=` 상세. 본문은 `renderMarkdown()`, `isAdmin()`일 때만 수정/삭제 |
| `news-write.html` | 작성/수정(`?id=`). `requireAdmin()`으로 비관리자는 `admin.html`로 이동 |
| `admin.html` | 비밀번호 로그인(sessionStorage `isAdmin`) + 게시글 관리 테이블 |
| `db.js` | 설정 로드, GitHub Contents API 읽기/쓰기, LocalStorage 캐시, 마크다운 렌더러 |
| `api/config.js` | Vercel 서버리스 함수. `GITHUB_TOKEN`(trim)과 `ADMIN_PASSWORD`만 반환 |
| `config/git_config.json` | `github_owner`, `github_repo`, `data_file_path`. 토큰은 항상 `YOUR_GITHUB_TOKEN` |
| `data/posts.json` | 게시글 배열 |
| `vercel.json` | `cleanUrls: true`, `trailingSlash: false` 두 줄만 |

## 게시글 스키마

```json
{
  "id": "1740355200000",
  "title": "제목",
  "category": "충무공동 시세동향",
  "author": "대표공인중개사 조우정",
  "date": "2025-02-24",
  "thumbnail": "",
  "content": "마크다운 본문"
}
```

카테고리: `충무공동 시세동향`, `분양·입주 소식`, `부동산 세무·정책`, `공인중개사 컬럼/일상` (`db.js`의 `BOARD_CATEGORIES`).

## 글 등록 절차

1. 사용자가 `templates/post-template.md` 형식으로 글을 준다.
2. 프론트매터의 `title`, `category`, `date`를 메타데이터로, 그 아래 마크다운만 `content`로 쓴다. 프론트매터는 사이트가 파싱하지 않는다.
3. `id`는 `Date.now()` 문자열로 만들어 `data/posts.json` 배열 맨 앞에 추가하고 커밋·푸시한다. 또는 관리자 페이지에서 직접 작성한다.

## 지켜야 할 규칙

- `public/` 폴더를 만들지 않는다. Vercel이 그 폴더를 사이트 루트로 삼아 루트 HTML이 모두 404가 된다.
- `vercel.json`에 `builds`, `routes`, `version`을 넣지 않는다. `/api/config`가 404가 된다.
- `loadConfig()`는 `/api/config`와 `config/git_config.json`을 둘 다 읽어 병합한다. 토큰은 API 값 우선, owner/repo/path는 항상 JSON 파일에서 읽는다.
- `Authorization` 헤더의 토큰은 `replace(/\s+/g, "")`로 정리한다.
- 실제 토큰을 저장소 파일에 쓰지 않는다(GitHub Push Protection).
- `renderMarkdown`은 입력을 먼저 HTML-escape한 뒤 서식을 입힌다. 링크는 http/https/mailto만 허용. 코드 스팬은 백틱 기준 분할.
- 목록·미리보기 요약은 `markdownToText(content).slice(0, N)`.
- `<img src>`, `<script src>`, `fetch()` 경로는 확장자를 유지한다. 페이지 링크는 `.html`을 붙여도 cleanUrls가 정규화한다.

## 로컬 실행

```bash
http-server -c-1 -p 8080
```

로컬에서는 `/api/config`가 없어 토큰이 비므로, 작성·삭제는 이 브라우저의 LocalStorage에만 저장된다.
