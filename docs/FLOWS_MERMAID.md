# Mermaid Diagrams (Deterministic MVP)

## 1) High-level Architecture

flowchart LR
VF[Voiceflow Project<br/>Deterministic Flows] -->|POST /webhook| SVC[Render Webhook Service]
SVC -->|retrieve| RETR[Retrieval Service (optional/RAG)]
SVC -->|generate_lesson| BIZ[Business Strategy Gen (stub or service)]
SVC -->|generate_quiz| PRM[Prompt/Quiz Gen (stub or service)]
SVC -->|export| EXP[Export (Markdown data URL / file)]
VF <-->|Embed| CONV[Convocore Site/App]

%% styles
classDef node fill:#0ea5e9,stroke:#0d3b66,color:#fff,stroke-width:1px;
class VF,SVC,RETR,PRM,BIZ,EXP,CONV node;

## 2) Welcome → Teach & Quiz Path

flowchart TD
A([Start: Welcome]) --> B{Have FirstName & Email?}
B -- No --> C[Call C_CollectNameEmail]
B -- Yes --> D[C_CaptureQuestion]
D --> E[C_OptimizeQuestion (optional)]
E --> F{Route}
F -- Teach & Quiz --> G[[W_TeachQuiz]]
F -- Ask KB --> H[[W_QueryKB]]
F -- Book Consult --> I[[W_BookConsult]]
F -- Submit Ticket --> J[[W_SubmitTicket]]

## 3) Teach & Quiz Orchestrator

flowchart TD
TQ([Enter W_TeachQuiz]) --> S1[Set APL_MCQ=0, APL_TF=0, APL_OPEN=0]
S1 --> L[Call C_GenerateLesson (webhook: generate_lesson)]
L --> A1[Speak title + brief]
A1 --> Q{Quiz now?}
Q -- Yes --> QZ[Call C_GenerateQuiz]
QZ --> A2[Speak counts + brief]
Q -- No --> END([End])

## 4) KB Query

flowchart TD
K1([Enter W_QueryKB]) --> K2[Call C_KB_Retrieve]
K2 --> K3{API_Hits > 0?}
K3 -- Yes --> K4[Speak API_Response]
K3 -- No --> K5[Offer: generate short lesson instead]
K5 -->|Yes| L1[Call C_GenerateLesson] --> L2[Speak title]
K5 -->|No| END([End])

## 5) Irate Gate (De-escalation)

flowchart TD
I0([Message enters component]) --> I1[Normalize text, set msg_lc = user_message toLowerCase]
I1 --> I2{Matches irate keywords or ALLCAPS+exclamations?}
I2 -- Yes --> I3[Speak calm apology + choices]
I2 -- No --> I4([Return: continue])
