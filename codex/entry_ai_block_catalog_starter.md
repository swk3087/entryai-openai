# 엔트리 AI 블록 카탈로그 스타터

이 파일은 **엔트리 오프라인/EntryJS용 AI 프롬프트 입력 자료의 스타터 버전**이다.

## 포함한 것
- 공식 사용자 문서에 나온 핵심 카테고리
- AI가 바로 쓰기 쉬운 **추천 alias**
- 블록 이름(한국어 표시명)
- 블록 종류(hat / stack / reporter / boolean / c-block)
- 파라미터 타입
- 한 줄 설명과 AI용 사용 힌트
- Project / Object / Function 기본 스키마

## 중요한 점
- `alias`는 **내부 EntryJS 공식 block id가 아니라, AI용 추천 식별자**다.
- `display_name_ko`는 공식 문서 표기를 최대한 그대로 옮겼다.
- 판단/계산/함수/데이터 분석/AI/확장/하드웨어는 **2차 확장 대상**으로 분리했다.

## 추천 사용 방식
1. 사용자의 자연어 요청을 받는다.
2. 현재 프로젝트 상태(`objects`, `variables`, `messages`, `scenes`, `functions`)를 요약한다.
3. 이 catalog를 system prompt 또는 tool schema 설명으로 넣는다.
4. 모델 출력은 **프로젝트 전체 JSON이 아니라 actions[]** 로 제한한다.
5. 네 프로그램이 actions를 검증한 뒤 Entry 프로젝트에 반영한다.

## 추천 action 예시
```json
{
  "actions": [
    {
      "tool": "create_object",
      "args": {
        "name": "플레이어",
        "objectType": "sprite",
        "sceneId": "scene1"
      }
    },
    {
      "tool": "add_script",
      "args": {
        "objectName": "플레이어",
        "blocks": [
          {
            "alias": "when_run_button_clicked"
          },
          {
            "alias": "repeat_forever",
            "body": [
              {
                "alias": "move_by_direction",
                "distance": 10
              }
            ]
          }
        ]
      }
    }
  ]
}
```

## 다음에 바로 붙이면 좋은 것
- 판단(boolean) 카탈로그
- 계산(reporter) 카탈로그
- 현재 프로젝트 snapshot 생성기
- validator
- alias → 실제 Entry 구조 변환기
