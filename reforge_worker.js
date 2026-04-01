function formatNumber(num) {
  if (!Number.isFinite(num)) {
    if (num === Infinity) return "1e30";
    if (num === -Infinity) return "-1e30";
    console.error("[LP] formatNumber received NaN, using 0");
    return "0";
  }
  return num.toFixed(10).replace(/\.?0+$/, "");
}
function buildObjective(variables, objectiveKey, variableNameMap) {
  const terms = [];
  for (const [varName, coefficients] of Object.entries(variables)) {
    const score = coefficients[objectiveKey];
    if (score !== void 0 && score !== 0) {
      const escapedName = variableNameMap.get(varName);
      if (terms.length === 0) {
        terms.push(`${formatNumber(score)} ${escapedName}`);
      } else {
        const sign = score >= 0 ? "+ " : "- ";
        terms.push(`${sign}${formatNumber(Math.abs(score))} ${escapedName}`);
      }
    }
  }
  if (terms.length === 0) {
    return [" obj: 0"];
  }
  const fullLine = " obj: " + terms.join(" ");
  return wrapExpression(fullLine, MAX_LINE_LENGTH);
}
const MAX_LINE_LENGTH = 200;
function wrapExpression(expression, maxLength) {
  if (expression.length <= maxLength) {
    return [expression];
  }
  const lines = [];
  let currentLine = "";
  const tokens = expression.split(" ");
  for (const token of tokens) {
    if (currentLine.length === 0) {
      currentLine = token;
    } else if (currentLine.length + 1 + token.length <= maxLength) {
      currentLine += " " + token;
    } else {
      lines.push(currentLine);
      currentLine = " " + token;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines;
}
function buildConstraints(variables, constraints, variableNameMap) {
  const lines = [];
  let constraintIndex = 0;
  for (const [constraintName, constraint] of Object.entries(constraints)) {
    if (constraint.equal === void 0 && constraint.min === void 0 && constraint.max === void 0) {
      console.warn(`[LP] Skipping constraint "${constraintName}" with no bounds defined`);
      continue;
    }
    const terms = [];
    for (const [varName, coefficients] of Object.entries(variables)) {
      const coeff = coefficients[constraintName];
      if (coeff !== void 0 && coeff !== 0) {
        const escapedName = variableNameMap.get(varName);
        if (terms.length === 0) {
          terms.push(`${formatNumber(coeff)} ${escapedName}`);
        } else {
          const sign = coeff >= 0 ? "+ " : "- ";
          terms.push(`${sign}${formatNumber(Math.abs(coeff))} ${escapedName}`);
        }
      }
    }
    if (terms.length === 0) {
      console.warn(`[LP] Skipping constraint "${constraintName}" with no variable coefficients`);
      continue;
    }
    const lhs = terms.join(" ");
    if (constraint.equal !== void 0) {
      const constraintLabel = `c${constraintIndex++}`;
      const fullLine = ` ${constraintLabel}: ${lhs} = ${formatNumber(constraint.equal)}`;
      lines.push(...wrapExpression(fullLine, MAX_LINE_LENGTH));
    } else {
      if (constraint.max !== void 0) {
        const constraintLabel = `c${constraintIndex++}`;
        const fullLine = ` ${constraintLabel}: ${lhs} <= ${formatNumber(constraint.max)}`;
        lines.push(...wrapExpression(fullLine, MAX_LINE_LENGTH));
      }
      if (constraint.min !== void 0) {
        const constraintLabel = `c${constraintIndex++}`;
        const fullLine = ` ${constraintLabel}: ${lhs} >= ${formatNumber(constraint.min)}`;
        lines.push(...wrapExpression(fullLine, MAX_LINE_LENGTH));
      }
    }
  }
  return lines;
}
function buildBounds(variableNames, isBinary) {
  if (isBinary) {
    return [];
  }
  return variableNames.map((name) => ` 0 <= ${name}`);
}
function buildBinaries(variableNames) {
  return variableNames.map((name) => ` ${name}`);
}
function modelToLPFormat(model) {
  const variableNameMap = /* @__PURE__ */ new Map();
  const reverseNameMap = /* @__PURE__ */ new Map();
  let varIndex = 0;
  for (const varName of Object.keys(model.variables)) {
    const escaped = `x${varIndex++}`;
    variableNameMap.set(varName, escaped);
    reverseNameMap.set(escaped, varName);
  }
  const lines = [];
  lines.push(model.direction === "maximize" ? "Maximize" : "Minimize");
  lines.push(...buildObjective(model.variables, model.objective, variableNameMap));
  const constraintLines = buildConstraints(model.variables, model.constraints, variableNameMap);
  if (constraintLines.length > 0) {
    lines.push("Subject To");
    lines.push(...constraintLines);
  }
  const escapedVarNames = Array.from(variableNameMap.values());
  const bounds = buildBounds(escapedVarNames, model.binaries);
  if (bounds.length > 0) {
    lines.push("Bounds");
    lines.push(...bounds);
  }
  if (model.binaries) {
    lines.push("Binary");
    lines.push(...buildBinaries(escapedVarNames));
  }
  lines.push("End");
  return {
    lpString: lines.join("\n"),
    variableNameMap,
    reverseNameMap
  };
}
function highsSolutionToLPSolution(highsSolution, reverseNameMap, tolerance = 0.5) {
  let status;
  switch (highsSolution.Status) {
    case "Optimal":
      status = "optimal";
      break;
    case "Infeasible":
      status = "infeasible";
      break;
    case "Unbounded":
      status = "unbounded";
      break;
    case "Time limit reached":
      status = "timedout";
      break;
    default:
      status = "unknown";
  }
  const variables = [];
  for (const [escapedName, column] of Object.entries(highsSolution.Columns)) {
    const originalName = reverseNameMap.get(escapedName);
    if (originalName && column.Primal >= tolerance) {
      variables.push([originalName, column.Primal]);
    }
  }
  return {
    status,
    result: highsSolution.ObjectiveValue,
    variables,
    bounded: status === "optimal",
    feasible: status === "optimal" || status === "unbounded"
  };
}
let highs = null;
let cachedWasmUrl = void 0;
function getBaseUrl() {
  try {
    const url = new URL(import.meta.url);
    return url.origin + url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1);
  } catch {
    return "/mop/";
  }
}
async function initHiGHS(wasmUrl) {
  if (highs) {
    return true;
  }
  if (wasmUrl) {
    cachedWasmUrl = wasmUrl;
  }
  try {
    const baseUrl = getBaseUrl();
    const locateFile = (file) => {
      if (file.endsWith(".wasm")) {
        return cachedWasmUrl || `${baseUrl}highs.wasm`;
      }
      return `${baseUrl}${file}`;
    };
    const highsModule = await import("./highs-DjLgcAeW.js");
    const highsFactory = highsModule.default || highsModule;
    highs = await highsFactory({ locateFile });
    return true;
  } catch (error) {
    console.error("[ReforgeWorker] Failed to initialize HiGHS:", error);
    return false;
  }
}
function postMsg(msg) {
  postMessage(msg);
}
async function solveProblem(msg) {
  const { id, model, options } = msg;
  try {
    const initSuccess = await initHiGHS();
    if (!initSuccess || !highs) {
      throw new Error("Failed to initialize HiGHS");
    }
    const { lpString, reverseNameMap } = modelToLPFormat(model);
    const highsOptions = {
      presolve: "on"
    };
    if (options.timeout) {
      highsOptions["time_limit"] = options.timeout / 1e3;
    }
    if (options.tolerance) {
    }
    const highsSolution = highs.solve(lpString, highsOptions);
    const solution = highsSolutionToLPSolution(highsSolution, reverseNameMap, 0.5);
    postMsg({
      msg: "solve",
      id,
      solution
    });
  } catch (error) {
    console.error("[ReforgeWorker] Error:", error);
    postMsg({
      msg: "error",
      id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
addEventListener("message", async ({ data }) => {
  const { id, msg } = data;
  switch (msg) {
    case "setID":
      postMsg({ msg: "idConfirm" });
      break;
    case "init": {
      const initMsg = data;
      const success = await initHiGHS(initMsg.wasmUrl);
      postMsg({
        msg: "init",
        id,
        success
      });
      break;
    }
    case "solve":
      await solveProblem(data);
      break;
  }
});
initHiGHS().then(() => {
  postMsg({ msg: "ready" });
});
