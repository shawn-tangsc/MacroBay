[English](./analysis-workflow.md) | [中文](./analysis-workflow.zh-CN.md)

# Analysis workflow

The market-intelligence workflow is designed to keep the question, the evidence, and the resulting
interpretation together.

![Analysis and agent](../assets/screenshots/demo-en-poster.png)

## 1. Choose a market or asset

Start from the intelligence portal or dashboard and select the market context you want to inspect.
The selection determines which evidence the analysis can use. A broader question can still be asked
without a selection, but the answer must then state that context is missing.

## 2. Bind the context

When a dashboard node or calendar event is selected, the conversation carries a reference to it.
The reference tells the agent which event or analysis node the question is about; the agent should
not silently guess a different one.

If the selected context cannot be read, the product reports the gap rather than replacing it with a
generic summary.

## 3. Ask the question

Questions should be specific enough to test against evidence:

- What changed in the last observation window?
- Which source produced this reading?
- What would invalidate the current interpretation?
- How does this event affect the selected market?

The agent may ask a structured question back when a choice changes the analysis, such as a time
window or a comparison baseline.

## 4. Read the analysis

A complete analysis separates:

- **facts** — observed values and their sources;
- **assumptions** — what the interpretation takes for granted;
- **conditions** — what would make the scenario change;
- **gaps** — what the available evidence does not answer.

It also states the observation time and the `asOf` boundary. An analysis without these elements is
incomplete.

## 5. Approvals and stopping

Tools that can read local files, run commands, or change state may require approval. The approval
row shows the tool and what it will do. Structured questions use a choice card rather than a JSON
editor.

You can stop a running turn. The execution trace keeps the completed steps and marks the turn as
stopped instead of pretending it succeeded.

## What the output is not

- It is not a trade instruction.
- It is not a guarantee that a scenario will happen.
- It is not a substitute for checking the underlying source record.

## Next

- [Traceability](./traceability.md)
- [Analyst agent](./analyst-agent.md)
