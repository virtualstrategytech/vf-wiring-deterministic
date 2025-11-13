# C_OptimizeQuestion

AI block:

- System/Instruction:
  “Rewrite the user’s message as a crisp, single-sentence question suitable for tool calls. Keep key context. ≤25 words.”
- User:
  "{user_message}"
- Output → Set variable: user_message (overwrite with the cleaned/optimized question)

Speak (optional preview):

- “Got it. I’ll use: {user_message}”
