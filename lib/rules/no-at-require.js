"use strict"

const { ruleMessages, validateOptions, report } = require("../utils/stylelint")
const { inCssLiteral } = require("../utils/nodes")
const { hasBlock } = require("../utils/ast")

const ruleName = "stylus/no-at-require"

module.exports = {
    ruleName,
    rule,
    meta: {
        docs: {
            description: "disallow `@require`, use `@import` instead.",
            category: "standard",
        },
        fixable: true,
    },
}

const messages = ruleMessages(ruleName, {
    rejected: "Unexpected '@require', use '@import' instead.",
})

function rule(expectation, _secondary, _context) {
    return (root, result) => {
        if (root.source.lang !== "stylus") {
            return
        }

        const validOptions = validateOptions(result, ruleName, {
            actual: expectation,
        })

        if (!validOptions) {
            return
        }

        root.walkAtRules((atRule) => {
            if (hasBlock(atRule)) {
                return
            }

            verifyNode(atRule)
        })

        function verifyNode(node) {
            if (node.name !== "require") {
                // Non target
                return
            }
            if (node.raws.identifier != null && node.raws.identifier !== "@") {
                // Not atrule
                return
            }
            if (inCssLiteral(node)) {
                return
            }

            report({
                message: messages.rejected,
                node,
                index: 0,
                endIndex: 1,
                result,
                ruleName,
                fix: () => {
                    node.name = "import"
                },
            })
        }
    }
}
