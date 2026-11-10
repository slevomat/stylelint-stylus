"use strict"

const { ruleMessages, validateOptions, report } = require("../../stylelint")
const { isStandardSyntaxRule } = require("../../ast")
const { parseSelector } = require("../../selector")
const { isStandardSyntaxSelector } = require("../../text")
const { levelOneAndTwoPseudoElements } = require("../../reference/selector")

const ruleName = "selector-pseudo-class-case"

const messages = ruleMessages(ruleName, {
    expected: (actual, expected) => `Expected "${actual}" to be "${expected}"`,
})

const meta = {
    url: "https://stylelint.io/user-guide/rules/selector-pseudo-class-case",
    fixable: true,
    deprecated: true,
}

/** @type {import('stylelint').Rule} */
const rule = (primary, _secondaryOptions) => {
    return (root, result) => {
        const validOptions = validateOptions(result, ruleName, {
            actual: primary,
            possible: ["lower", "upper"],
        })

        if (!validOptions) {
            return
        }

        root.walkRules((ruleNode) => {
            if (!isStandardSyntaxRule(ruleNode)) {
                return
            }

            const selector = ruleNode.selector

            if (!selector.includes(":")) {
                return
            }

            let needsFix = false
            const fixedSelector = parseSelector(
                ruleNode.raws.selector
                    ? ruleNode.raws.selector.raw
                    : ruleNode.selector,
                result,
                ruleNode,
                (selectorTree) => {
                    selectorTree.walkPseudos((pseudoNode) => {
                        const pseudo = pseudoNode.value

                        if (!isStandardSyntaxSelector(pseudo)) {
                            return
                        }

                        if (
                            pseudo.includes("::") ||
                            levelOneAndTwoPseudoElements.has(
                                pseudo.toLowerCase().slice(1),
                            )
                        ) {
                            return
                        }

                        const expectedPseudo =
                            primary === "lower"
                                ? pseudo.toLowerCase()
                                : pseudo.toUpperCase()

                        if (pseudo === expectedPseudo) {
                            return
                        }

                        report({
                            message: messages.expected(pseudo, expectedPseudo),
                            node: ruleNode,
                            index: pseudoNode.sourceIndex,
                            endIndex:
                                pseudoNode.sourceIndex + pseudo.length,
                            ruleName,
                            result,
                            fix: () => {
                                pseudoNode.value = expectedPseudo
                                needsFix = true
                            },
                        })
                    })
                },
            )

            if (needsFix && fixedSelector) {
                if (ruleNode.raws.selector) {
                    ruleNode.raws.selector.raw = fixedSelector
                } else {
                    ruleNode.selector = fixedSelector
                }
            }
        })
    }
}

rule.ruleName = ruleName
rule.messages = messages
rule.meta = meta
module.exports = rule
