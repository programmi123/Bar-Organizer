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

    let filtered = recipeDatabase.filter(recipe => {
        const matchesType = currentFilter === "Alles" || recipe.type === currentFilter;
        const nameMatch = recipe.name.toLowerCase().startsWith(query);
        const ingredientMatch = queryIngredients.filter(q =>
            recipe.ingredients.some(ingredient => ingredient.item.toLowerCase().startsWith(q))
        );
        return matchesType && (nameMatch || ingredientMatch.length > 0);
    });

    filtered.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        if (nameA.startsWith(query) && !nameB.startsWith(query)) return -1;
        if (!nameA.startsWith(query) && nameB.startsWith(query)) return 1;
        return nameA.localeCompare(nameB);
    });

    resultsDiv.innerHTML = '';

    let lastMatchCount = null;
    filtered.forEach(recipe => {
        const missingCount = queryIngredients.length - recipe.ingredients.filter(ing =>
            queryIngredients.some(q => ing.item.toLowerCase().startsWith(q))
        ).length;

        if (lastMatchCount !== null && missingCount > 1 && lastMatchCount <= 1) {
            const separator = document.createElement('div');
            separator.classList.add('separator');
            separator.textContent = 'Mehr als eine Zutat fehlt';
            resultsDiv.appendChild(separator);
        }
        lastMatchCount = missingCount;

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
    });
}
