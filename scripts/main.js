let recipeDatabase = [];
let currentFilter = "Alles";

document.addEventListener("DOMContentLoaded", loadRecipes);

async function loadRecipes() {
    const response = await fetch('recipes.json');
    recipeDatabase = await response.json();
    updateRecipeCount();
    searchRecipes();
}

function updateRecipeCount() {
    document.getElementById("count").textContent = recipeDatabase.length;
}

function filterByType(type) {
    currentFilter = type;
    document.querySelectorAll("button").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`btn${type}`).classList.add("active");
    searchRecipes();
}

function searchRecipes() {
    const query = document.getElementById('search').value.toLowerCase();
    const resultsDiv = document.getElementById('results');
    const queryIngredients = query.split(',').map(q => q.trim()).filter(q => q !== '');

    let fullMatchRecipes = [];
    let partialMatchRecipes = [];

    recipeDatabase.forEach(recipe => {
        const matchesType = currentFilter === "Alles" || recipe.type === currentFilter;
        if (!matchesType) return;

        const nameMatch = recipe.name.toLowerCase().startsWith(query);
        const matchingIngredients = recipe.ingredients.filter(ing =>
            queryIngredients.some(q => ing.item.toLowerCase().startsWith(q))
        );
        const missingCount = queryIngredients.length - matchingIngredients.length;

        if (nameMatch || matchingIngredients.length > 0) {
            if (missingCount === 0) {
                fullMatchRecipes.push(recipe);
            } else {
                partialMatchRecipes.push({ recipe, missingCount });
            }
        }
    });

    fullMatchRecipes.sort((a, b) => a.name.localeCompare(b.name));
    partialMatchRecipes.sort((a, b) => a.missingCount - b.missingCount || a.recipe.name.localeCompare(b.recipe.name));

    resultsDiv.innerHTML = '';

    fullMatchRecipes.forEach(recipe => displayRecipe(recipe, resultsDiv));

    if (partialMatchRecipes.length > 0) {
        const separator = document.createElement('div');
        separator.classList.add('separator');
        separator.textContent = 'Mehr als eine Zutat fehlt';
        resultsDiv.appendChild(separator);

        partialMatchRecipes.forEach(({ recipe }) => displayRecipe(recipe, resultsDiv));
    }
}

function displayRecipe(recipe, resultsDiv) {
    const recipeDiv = document.createElement('div');
    recipeDiv.classList.add('recipe');

    const title = document.createElement('h2');
    title.textContent = recipe.name;

    const symbols = document.createElement('div');
    symbols.classList.add('symbols');
    symbols.textContent = recipe.symbols;

    const ingredientsList = document.createElement('ul');
    recipe.ingredients.forEach(ingredient => {
        const li = document.createElement('li');
        li.textContent = `${ingredient.amount} ${ingredient.item}`;
        ingredientsList.appendChild(li);
    });

    const instructions = document.createElement('p');
    instructions.textContent = recipe.recipe;

    recipeDiv.appendChild(title);
    recipeDiv.appendChild(symbols);
    recipeDiv.appendChild(ingredientsList);
    recipeDiv.appendChild(instructions);
    resultsDiv.appendChild(recipeDiv);
}
