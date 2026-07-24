# 나란히 성경

개역개정, 개역한글, 새번역, 우리말, 현대인의성경, ESV, NIV, KJV, NASB, NRSV, 新译本(CNV) 본문을 절 단위로 비교하고 여러 성경을 패널로 동시에 펼쳐 보는 정적 웹사이트입니다. 헤더의 **＋ Versions** 선택창에서 English / Korean / Chinese 그룹별로 역본을 골라 추가하거나 빼고, 칩을 드래그해 순서를 바꿉니다.

## 데이터 생성

Python 3만 있으면 됩니다. `data.db`를 갱신한 뒤 다음 명령으로 브라우저용 데이터를 다시 만듭니다.

```powershell
python scripts/export_data.py
```

KJV(영어)와 CNV(중국어 신역본, 간체) 원문은 `scripts/import_kjv_cnv.py`가, NASB(1995)와 NRSV 원문은 `scripts/import_nasb_nrsv.py`가 인터넷에서 내려받아 `data.db`에 채워 넣습니다(재실행 시 갱신).

## 로컬 미리보기

브라우저의 파일 열기가 아니라 HTTP 서버를 사용해야 JSON 데이터를 불러올 수 있습니다.

```powershell
python -m http.server 8000
```

그다음 `http://localhost:8000`을 엽니다.

## GitHub Pages

저장소의 **Settings → Pages**에서 배포 소스를 `main` 브랜치의 루트(`/`)로 지정합니다. 저장소가 비공개라면 사용 중인 GitHub 요금제에서 비공개 저장소의 Pages 배포를 지원해야 합니다.
