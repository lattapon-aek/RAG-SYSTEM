"""
Tool Router — ReAct pattern
Tools: Calculator, DateTime, CodeExecutor (sandboxed), TavilyWebSearch
"""
import ast
import json
import logging
import math
import re
import textwrap
from datetime import datetime, timezone
from typing import List, Optional, Any

from application.ports.i_tool_router import IToolRouter
from application.ports.i_llm_service import ILLMService
from domain.entities import ToolCall

logger = logging.getLogger(__name__)

_REACT_PROMPT = textwrap.dedent("""
You are an assistant. You have access to tools, but use them ONLY when necessary.
Available tools: {tools}

Use a tool when the question needs real-time data, math calculation, or code execution.
Answer directly from context when possible.

To answer directly:
Thought: The context contains the answer.
Final Answer: <your answer>

To use a tool:
Thought: <why you need this tool>
Action: <tool_name>
Action Input: <JSON input>
Observation: <tool result>
Thought: I now have the answer.
Final Answer: <your answer>

Question: {query}
Context: {context}
""").strip()


# ---- Individual Tools ----

class CalculatorTool:
    name = "calculator"
    description = "Evaluate a mathematical expression. Input: {\"expression\": \"2+2\"}"

    def run(self, input_data: dict) -> Any:
        expr = input_data.get("expression", "")
        # Safe eval: only allow math operations
        allowed = set("0123456789+-*/().% ")
        if not all(c in allowed for c in expr):
            return "Error: invalid expression"
        try:
            result = eval(expr, {"__builtins__": {}}, vars(math))  # noqa: S307
            return result
        except Exception as exc:
            return f"Error: {exc}"


class DateTimeTool:
    name = "datetime"
    description = "Get current date/time. Input: {\"timezone\": \"UTC\"}"

    def run(self, input_data: dict) -> Any:
        return datetime.now(timezone.utc).isoformat()


class CodeExecutorTool:
    name = "code_executor"
    description = "Execute sandboxed Python code. Input: {\"code\": \"print(1+1)\"}"

    def run(self, input_data: dict) -> Any:
        code = input_data.get("code", "")
        # Minimal sandbox: restrict builtins
        safe_globals = {
            "__builtins__": {
                "print": print, "len": len, "range": range,
                "int": int, "float": float, "str": str, "list": list,
                "dict": dict, "sum": sum, "min": min, "max": max,
            }
        }
        output_lines: List[str] = []
        safe_globals["__builtins__"]["print"] = lambda *a: output_lines.append(" ".join(str(x) for x in a))
        try:
            exec(code, safe_globals)  # noqa: S102
            return "\n".join(output_lines) or "OK"
        except Exception as exc:
            return f"Error: {exc}"


# ---- ReAct Tool Router ----

class ReActToolRouter(IToolRouter):
    def __init__(self, llm: ILLMService, tools: Optional[List] = None,
                 max_steps: int = 1):
        self._llm = llm
        self._tools = {t.name: t for t in (tools or [
            CalculatorTool(), DateTimeTool(), CodeExecutorTool(),
        ])}
        self._max_steps = max_steps

    _DATETIME_PATTERNS = re.compile(
        r"\b(current|now|today|what time|what date|utc|time is it|date is it)\b", re.I
    )

    async def route(self, query: str, context: str) -> List[ToolCall]:
        # Pre-routing: guarantee tool call for obvious patterns (small models are unreliable)
        if "datetime" in self._tools and self._DATETIME_PATTERNS.search(query):
            dt_tool = self._tools["datetime"]
            try:
                output = dt_tool.run({"timezone": "UTC"})
            except Exception as exc:
                output = f"Tool error: {exc}"
            return [ToolCall(
                tool_name="datetime", input={"timezone": "UTC"}, output=output,
                timestamp=datetime.now(timezone.utc),
            )]

        tool_descriptions = "; ".join(
            f"{t.name}: {t.description}" for t in self._tools.values()
        )
        prompt = _REACT_PROMPT.format(
            tools=tool_descriptions, query=query, context=context[:500]
        )
        calls: List[ToolCall] = []

        _TOOL_SYSTEM = "/no_think Follow the ReAct format exactly. Use tools when needed for real-time data or calculations."

        for _ in range(self._max_steps):
            try:
                response = await self._llm.generate(prompt, system_prompt=_TOOL_SYSTEM, max_tokens=512)
            except Exception as exc:
                logger.warning("Tool router LLM call failed: %s", exc)
                break

            logger.debug("Tool router LLM response: %r", response[:300])
            action_match = re.search(r"Action:\s*(\w+)", response)
            input_match = re.search(r"Action Input:\s*(\{.*?\})", response, re.DOTALL)

            # Action takes priority — model may include Final Answer in same response
            if not action_match:
                # Capture direct answer — try "Final Answer:" prefix first, else use full response
                fa_match = re.search(r"Final Answer:\s*(.+?)(?:\n\n|$)", response, re.DOTALL)
                direct_text = fa_match.group(1).strip() if fa_match else response.strip()
                if direct_text and not calls:
                    calls.append(ToolCall(
                        tool_name="direct_answer",
                        input={},
                        output=direct_text,
                        timestamp=datetime.now(timezone.utc),
                    ))
                break

            tool_name = action_match.group(1).strip()
            tool_input: dict = {}
            if input_match:
                try:
                    tool_input = json.loads(input_match.group(1))
                except json.JSONDecodeError:
                    pass

            tool = self._tools.get(tool_name)
            if not tool:
                output = f"Unknown tool: {tool_name}"
            else:
                try:
                    output = tool.run(tool_input)
                except Exception as exc:
                    output = f"Tool error: {exc}"

            calls.append(ToolCall(
                tool_name=tool_name,
                input=tool_input,
                output=output,
                timestamp=datetime.now(timezone.utc),
            ))

            # Append observation to prompt for next step
            prompt += f"\n{response}\nObservation: {output}\n"

        return calls


