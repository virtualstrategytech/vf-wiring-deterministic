Smoke path A (Manual):

- Start → name+email valid
- Capture question → Teach&Quiz → lesson → AgentTurn → quiz → AgentTurn
- Book consult from menu → link opens with prefilled params

Smoke path B (KB first):

- Ask KB → if API_Hits>0 Speak→AgentTurn → Offer lesson → quiz → AgentTurn

Failure checks:

- Stop webhook → API block shows friendly fail; branch back to menu
- Set quiz counts to 0 at Orchestrator entry; verify they reflect new run
