"use strict"

const fs = require("fs")
const path = require("path")
const { pathToFileURL } = require("url")

module.exports = {
    loadCoreRule,
    report,
    ruleMessages,
    validateOptions,
}

function loadCoreRule(name) {
    try {
        // eslint-disable-next-line node/no-missing-require -- supports legacy CommonJS Stylelint installations
        const stylelintPath = require.resolve("stylelint", {
            paths: [process.cwd()],
        })
        const stylelintMod = require(stylelintPath)
        const stylelint = stylelintMod.default || stylelintMod
        const rule = stylelint.rules && stylelint.rules[name]
        if (rule) {
            return Promise.resolve(rule)
        }

        const rulePath = require.resolve(`stylelint/lib/rules/${name}`, {
            paths: [process.cwd()],
        })
        return Promise.resolve(require(rulePath))
    } catch {
        // Stylelint 18 is ESM-only; load it asynchronously below.
    }

    // eslint-disable-next-line node/no-missing-import, node/no-unsupported-features/es-syntax -- Stylelint 18 is ESM-only
    return import("stylelint").then(async (stylelintMod) => {
        const stylelint = stylelintMod.default || stylelintMod
        const rule = stylelint.rules && stylelint.rules[name]
        if (rule) {
            return rule
        }

        const stylelintPath = path.dirname(
            require.resolve("stylelint/package.json"),
        )
        const candidates = [
            path.join(stylelintPath, "lib", "rules", name, "index.mjs"),
            path.join(stylelintPath, "lib", "rules", `${name}.mjs`),
            path.join(stylelintPath, "lib", "rules", name, "index.js"),
            path.join(stylelintPath, "lib", "rules", `${name}.js`),
        ]
        const rulePath = candidates.find((candidate) =>
            fs.existsSync(candidate),
        )

        if (rulePath) {
            // eslint-disable-next-line node/no-unsupported-features/es-syntax -- Stylelint 18 is ESM-only
            const ruleModule = await import(pathToFileURL(rulePath).href)
            return ruleModule.default || ruleModule
        }

        throw new Error(`Could not load stylelint rule "${name}"`)
    })
}

function ruleMessages(ruleName, messages) {
    const newMessages = {}

    for (const [messageId, messageText] of Object.entries(messages)) {
        if (typeof messageText === "string") {
            newMessages[messageId] = `${messageText} (${ruleName})`
        } else {
            newMessages[messageId] = (...args) =>
                `${messageText(...args)} (${ruleName})`
            Object.defineProperty(newMessages[messageId], "length", {
                value: messageText.length,
            })
        }
    }

    return newMessages
}

function validateOptions(result, ruleName, ...optionDescriptions) {
    if (!result.stylelint.config?.validate) {
        return true
    }

    let noErrors = true

    const complain = (message) => {
        noErrors = false
        result.warn(message, {
            stylelintType: "invalidOption",
        })
        result.stylelint.stylelintError = true
    }

    for (const optionDescription of optionDescriptions) {
        validate(optionDescription, ruleName, complain)
    }

    return noErrors
}

function validate({ possible, actual, optional }, ruleName, complain) {
    const ignoredOptions = new Set([
        "severity",
        "message",
        "url",
        "reportDisables",
        "disableFix",
    ])

    if (actual === false && !["reportDisables"].includes(ruleName)) {
        complain(
            `Invalid option value "false" for rule "${ruleName}". Are you trying to disable this rule? If so use "null" instead`,
        )
        return
    }

    if (actual === null || (Array.isArray(actual) && actual.length === 1 && actual[0] === null)) {
        return
    }

    const nothingPossible =
        possible === undefined ||
        possible === null ||
        (Array.isArray(possible) && possible.length === 0) ||
        (isPlainObject(possible) && Object.keys(possible).length === 0)

    if (nothingPossible && actual === true) {
        return
    }

    if (actual === undefined) {
        if (nothingPossible || optional) {
            return
        }

        complain(`Expected option value for rule "${ruleName}"`)
        return
    }

    if (nothingPossible) {
        if (optional) {
            complain(
                `Incorrect configuration for rule "${ruleName}". Rule should have "possible" values for options validation`,
            )
        } else {
            complain(
                `Unexpected option value ${stringify(actual)} for rule "${ruleName}"`,
            )
        }
        return
    }

    if (typeof possible === "function") {
        if (!possible(actual)) {
            complain(`Invalid option ${stringify(actual)} for rule "${ruleName}"`)
        }
        return
    }

    if (Array.isArray(possible)) {
        for (const value of [actual].flat()) {
            if (!isValid(possible, value)) {
                complain(
                    `Invalid option value ${stringify(value)} for rule "${ruleName}"`,
                )
            }
        }
        return
    }

    if (!isPlainObject(actual)) {
        complain(
            `Invalid option value ${stringify(actual)} for rule "${ruleName}": should be an object`,
        )
        return
    }

    for (const [optionName, optionValue] of Object.entries(actual)) {
        if (ignoredOptions.has(optionName)) {
            continue
        }

        const possibleValue = possible && possible[optionName]
        if (!possibleValue) {
            complain(
                `Invalid option name "${optionName}" for rule "${ruleName}"`,
            )
            continue
        }

        for (const value of [optionValue].flat()) {
            if (!isValid(possibleValue, value)) {
                complain(
                    `Invalid value ${stringify(value)} for option "${optionName}" of rule "${ruleName}"`,
                )
            }
        }
    }
}

function isValid(possible, actual) {
    for (const possibility of [possible].flat()) {
        if (typeof possibility === "function" && possibility(actual)) {
            return true
        }
        if (actual === possibility) {
            return true
        }
    }
    return false
}

function isPlainObject(value) {
    if (value === null || typeof value !== "object") {
        return false
    }
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function stringify(value) {
    if (typeof value === "string") {
        return `"${value}"`
    }
    return `"${JSON.stringify(value)}"`
}

function report(problem) {
    const { node, result, ruleName, fix, ...rest } = problem
    const problemRange = getProblemRange(problem)
    const stylelint = result.stylelint
    const {
        disabledRanges = {},
        quiet,
        ruleSeverities = {},
        config = {},
        customMessages = {},
        customUrls = {},
        ruleMetadata = {},
    } = stylelint
    const { messageArgs = [], severity = ruleSeverities[ruleName] } = rest
    const ruleSeverity =
        (typeof severity === "function"
            ? severity(...messageArgs)
            : severity) ??
        config.defaultSeverity ??
        "error"

    if (quiet && ruleSeverity === "warning") {
        return
    }

    if (isFix(fix) && ruleMetadata[ruleName] && !ruleMetadata[ruleName].fixable) {
        throw new Error(
            `The "${ruleName}" rule requires "meta.fixable" to be truthy if the "fix" callback is being passed`,
        )
    }

    if (isFixApplied(problem, problemRange.start.line)) {
        return
    }

    if (isDisabledOnLine(ruleName, problemRange.start.line, disabledRanges)) {
        if (!stylelint.disabledWarnings) {
            stylelint.disabledWarnings = []
        }
        const disabledWarnings = stylelint.disabledWarnings
        disabledWarnings.push({
            rule: ruleName,
            line: problemRange.start.line,
        })
        if (!config.ignoreDisables) {
            return
        }
    }

    if (!stylelint.stylelintError && ruleSeverity === "error") {
        stylelint.stylelintError = true
    }
    if (!stylelint.stylelintWarning && ruleSeverity === "warning") {
        stylelint.stylelintWarning = true
    }

    const message = customMessages[ruleName] || rest.message
    const warningMessage = appendRuleName(
        typeof message === "string"
            ? printfLike(message, ...messageArgs)
            : message(...messageArgs),
        ruleName,
    )
    const warningProperties = {
        severity: ruleSeverity,
        rule: ruleName,
        node,
        start: problemRange.start,
        end: problemRange.end,
    }

    if (customUrls[ruleName]) {
        warningProperties.url = customUrls[ruleName]
    }

    result.warn(warningMessage, warningProperties)
}

function getProblemRange(problem) {
    const { node } = problem
    if (!node) {
        throw new Error(
            `The "${problem.ruleName}" rule provided incorrect position arguments to \`utils.report()\`. To fix, pass a PostCSS \`node\` to the function.`,
        )
    }

    if (isRange(problem)) {
        return {
            start: problem.start,
            end: problem.end,
        }
    }

    if ("start" in problem || "end" in problem) {
        throw new Error(
            `The "${problem.ruleName}" rule provided incomplete position arguments to \`utils.report()\`. To fix, provide both \`start\` and \`end\` as valid positions to the function.`,
        )
    }

    if (hasIndices(problem)) {
        return node.rangeBy({
            index: problem.index,
            endIndex: problem.endIndex,
        })
    }

    if ("index" in problem || "endIndex" in problem) {
        throw new Error(
            `The "${problem.ruleName}" rule provided incomplete position arguments to \`utils.report()\`. To fix, provide both \`index\` and \`endIndex\` as numbers to the function.`,
        )
    }

    if (typeof problem.word === "string") {
        return node.rangeBy({ word: problem.word })
    }

    return node.rangeBy({})
}

function isFixApplied({ fix, result, ruleName }, line) {
    const stylelint = result.stylelint
    const config = stylelint.config || {}
    if (!isFix(fix) || !config.fix) {
        return false
    }
    if (isFixDisabled(line, ruleName, config, stylelint.disabledRanges || {})) {
        return false
    }

    const apply = isFixObject(fix) ? fix.apply : fix
    apply()
    if (!stylelint.fixersData) {
        stylelint.fixersData = {}
    }

    const fixersData = stylelint.fixersData
    fixersData[ruleName] = (fixersData[ruleName] || 0) + 1
    return true
}

function isFix(value) {
    return typeof value === "function" || isFixObject(value)
}

function isFixObject(value) {
    return (
        isPlainObject(value) &&
        value.node &&
        typeof value.apply === "function"
    )
}

function isRange(value) {
    return (
        isPlainObject(value) &&
        isPosition(value.start) &&
        isPosition(value.end)
    )
}

function isPosition(value) {
    return (
        isPlainObject(value) &&
        isNumber(value.line) &&
        isNumber(value.column)
    )
}

function isNumber(value) {
    return typeof value === "number" || value instanceof Number
}

function hasIndices(value) {
    return (
        isPlainObject(value) &&
        isNumber(value.index) &&
        isNumber(value.endIndex)
    )
}

function isFixDisabled(line, ruleName, config, disabledRanges) {
    if (config.rules?.[ruleName]?.[1]?.disableFix) {
        return true
    }
    return !config.ignoreDisables && isDisabledOnLine(ruleName, line, disabledRanges)
}

function isDisabledOnLine(ruleName, line, disabledRanges) {
    const ranges = disabledRanges[ruleName] || disabledRanges.all || []
    return ranges.some(
        (range) =>
            range.start <= line &&
            (range.end === undefined || range.end >= line) &&
            (!range.rules || range.rules.includes(ruleName)),
    )
}

function appendRuleName(message, ruleName) {
    return message.endsWith(`(${ruleName})`)
        ? message
        : `${message} (${ruleName})`
}

function printfLike(format, ...args) {
    return args.reduce(
        (result, arg) => result.replace(/%[ds]/u, String(arg)),
        format,
    )
}
