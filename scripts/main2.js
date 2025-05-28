// scripts/main.js
import { db } from "../index.html"; // import the initialized Database instance
import { ref, get } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-database.js";

let recipeDatabase = [];
let currentFilter = "Alles";

// We no longer fetch 'recipes.json'. Instead, read from the RTDB path "/recipes".
async function loadRecipes() {
  try {
    // Create a reference to "/recipes" in your Realtime Database
    const recipesRef = ref(db, "recipes");

    // Read the entire "/recipes" node once
    const snapshot = await get(recipesRef);

    if (snapshot.exists()) {
      // Assuming your recipes are stored as an array or object under "recipes"
      // Convert snapshot.val() into an array of recipe objects
      const data = snapshot.val();

      // If your node is an object keyed by push‐IDs, do this:
      if (typeof data === "object" && !Array.isArray(data)) {
        // Convert to an array (dropping keys, keeping only values)
        recipeDatabase = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));
      } else {
        // If it's already an array in your DB, just assign directly:
        recipeDatabase = data;
      }
      searchRecipes();
    } else {
      console.warn("Keine Rezepte in der Realtime Database gefunden.");
      recipeDatabase = [];
      searchRecipes();
    }
  } catch (error) {
    console.error("Fehler beim Laden der Rezepte aus Firebase:", error);
  }
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
  const query = document.getElementById("search").value.toLowerCase();
  const resultsDiv = document.getElementById("results");
  const queryIngredients = query
    .split(",")
    .map((q) => q.trim())
    .filter((q) => q !== "");

  const filtered = recipeDatabase.filter((recipe) => {
    const matchesType =
      currentFilter === "Alles" || recipe.type === currentFilter;
    const nameMatch = recipe.name.toLowerCase().includes(query);
    const ingredientMatch = queryIngredients.every((q) =>
      recipe.ingredients.some((ingredient) =>
        ingredient.item.toLowerCase().includes(q)
      )
    );
    return matchesType && (nameMatch || ingredientMatch);
  });

  resultsDiv.innerHTML = "";

  if (filtered.length > 0) {
    filtered.forEach((recipe) => {
      const recipeDiv = document.createElement("div");
      recipeDiv.classList.add("recipe");

      const title = document.createElement("h2");
      title.textContent = recipe.name;

      const symbols = document.createElement("div");
      symbols.classList.add("symbols");
      symbols.textContent = recipe.symbols || "";

      const ingredientsList = document.createElement("ul");
      recipe.ingredients.forEach((ingredient) => {
        const li = document.createElement("li");
        li.textContent = `${ingredient.amount} ${ingredient.item}`;
        ingredientsList.appendChild(li);
      });

      const instructions = document.createElement("p");
      instructions.textContent = recipe.recipe;

      recipeDiv.appendChild(title);
      recipeDiv.appendChild(symbols);
      recipeDiv.appendChild(ingredientsList);
      recipeDiv.appendChild(instructions);
      resultsDiv.appendChild(recipeDiv);
    });
  } else {
    resultsDiv.innerHTML = `<p>Keine passenden Rezepte gefunden.</p>`;
  }
}

// Initiales Laden der Rezepte
loadRecipes();
