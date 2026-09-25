"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app/companion-cheatsheet.html"), "utf8");
const context = vm.createContext({ URL, URLSearchParams });
for (const name of ["strictFiniteBuilderNumber", "getWorkflowDefinitions", "psLiteral", "simplePowerShell", "recipePath", "powerShellPreamble", "buildRecipeScript", "workflowRecipes", "maskRecipe", "boundWorkflowRecipes", "presetWorkflowRecipes", "recipeExecution", "partitionRecipes"]) {
    const start = source.indexOf("function " + name + "(");
    const indent = source.slice(source.lastIndexOf("\n", start) + 1, start);
    const end = source.indexOf("\n" + indent + "function ", start + 1);
    if (start < 0 || end < 0) throw Error("Missing Builder function " + name);
    vm.runInContext(source.slice(start, end), context);
}
const cards = context.getWorkflowDefinitions();
const recipes = cards.flatMap(card => context.workflowRecipes(card).map(recipe => ({card, recipe,
    values: Object.fromEntries((recipe.inputs || []).map(field => [field.key, String(field.value)]))})));
module.exports = { ...context, cards, recipes, source };
