let recipeDatabase = [];
let currentFilter = "Alles";

async function loadRecipes() {
    const response = await fetch('recipes.json');
    recipeDatabase = await response.json();
    searchRecipes();
}

function filterByType(type) {
    currentFilter = type;
    document.getElementById("btnMocktails").classList.remove("active");
    document.getElementById("btnCocktails").classList.remove("active");
    document.getElementById("btnAll").classList.remove("active");

    if (type === "Mocktail") {
        document.getElementById("btnMocktails").classList.add("active");
    } else if (type === "Cocktail") {
        document.getElementById("btnCocktails").classList.add("active");
    } else {
        document.getElementById("btnAll").classList.add("active");
    }

    searchRecipes();
}

function searchRecipes() {
    const query = document.getElementById('search').value.toLowerCase();
    const resultsDiv = document.getElementById('results');
    const queryIngredients = query.split(',').map(q => q.trim()).filter(q => q !== '');

    const filtered = recipeDatabase.filter(recipe => {
        const matchesType = currentFilter === "Alles" || recipe.type === currentFilter;
        const nameMatch = recipe.name.toLowerCase().includes(query);
        const ingredientMatch = queryIngredients.every(q =>
            recipe.ingredients.some(ingredient => ingredient.item.toLowerCase().includes(q))
        );
        return matchesType && (nameMatch || ingredientMatch);
    });

    resultsDiv.innerHTML = '';

    if (filtered.length > 0) {
        filtered.forEach(recipe => {
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
    } else {
        resultsDiv.innerHTML = '<p>Keine passenden Rezepte gekackt.</p>';
    }
}

// Initiales Laden der Rezepte
loadRecipes();
