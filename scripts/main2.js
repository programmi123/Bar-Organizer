// scripts/main.js
import { db } from "../index.html";
import {
  ref,
  get,
  push,       // zum Hinzufügen eines neuen Knoten
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.8.1/firebase-database.js";

let recipeDatabase = [];
let currentFilter = "Alles";

/** Lädt alle Rezepte aus /recipes und zeigt sie an */
async function loadRecipes() {
  try {
    const recipesRef = ref(db, "recipes");
    const snapshot = await get(recipesRef);

    if (snapshot.exists()) {
      const data = snapshot.val();

      if (typeof data === "object" && !Array.isArray(data)) {
        // Wenn unter /recipes ein Objekt mit Push-IDs liegt:
        recipeDatabase = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));
      } else {
        // Falls bereits ein Array gespeichert ist:
        recipeDatabase = data;
      }
    } else {
      recipeDatabase = [];
    }
    searchRecipes();
  } catch (error) {
    console.error("Fehler beim Laden der Rezepte aus Firebase:", error);
  }
}

/** Filtert nach Typ und Suchbegriff, rendert die Ergebnisse unter #results */
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

  // Leere vorherige Ergebnisse:
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

/** Schaltet die Filter-Buttons um und ruft searchRecipes() auf */
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

/** ====== NEUER TEIL: Formular-Logik zum Erstellen eines neuen Rezepts ====== **/

// Helper: Liest alle Zutat-Zeilen aus und gibt ein Array von {amount, item} zurück.
function readIngredients() {
  const container = document.getElementById("ingredientsContainer");
  const rows = container.querySelectorAll(".ingredient-row");
  const ingredients = [];

  rows.forEach((row) => {
    const amt = row.querySelector(".ingredient-amount").value.trim();
    const item = row.querySelector(".ingredient-item").value.trim();
    if (amt && item) {
      ingredients.push({ amount: amt, item: item });
    }
  });

  return ingredients;
}

// Fügt dem Zutaten-Container eine neue Zeile (Menge + Artikel + "–"-Button) hinzu
function addIngredientRow() {
  const container = document.getElementById("ingredientsContainer");
  const newRow = document.createElement("div");
  newRow.classList.add("ingredient-row");

  newRow.innerHTML = `
    <input type="text" class="ingredient-amount" placeholder="Menge (z.B. 20ml)" required />
    <input type="text" class="ingredient-item" placeholder="Zutat (z.B. Limettensaft)" required />
    <button type="button" class="remove-ingredient">–</button>
  `;
  container.appendChild(newRow);
}

// Entfernt die jeweilige Zeile, wenn der Benutzer auf “–” klickt
function attachIngredientRemoval() {
  document
    .querySelectorAll(".remove-ingredient")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const row = e.target.closest(".ingredient-row");
        row.remove();
      });
    });
}

async function handleNewRecipeSubmit(event) {
  event.preventDefault();

  // 1) Werte aus den Formularfeldern lesen
  const name = document.getElementById("newName").value.trim();
  const type = document.getElementById("newType").value;
  const symbols = document.getElementById("newSymbols").value.trim();
  const instructions = document.getElementById("newRecipeText").value.trim();
  const ingredients = readIngredients();

  if (!name || !type || ingredients.length === 0 || !instructions) {
    alert("Bitte alle Pflichtfelder ausfüllen und mindestens eine Zutat angeben.");
    return;
  }

  // 2) Objekt für die Realtime Database zusammenbauen
  const newRecipe = {
    name,
    type,
    symbols: symbols || "",
    ingredients,
    recipe: instructions,
    createdAt: serverTimestamp(), // optional: Zeitstempel
  };

  try {
    // 3) In Firebase push() – dadurch erhält es eine eindeutige Push-ID
    const recipesRef = ref(db, "recipes");
    await push(recipesRef, newRecipe);

    // 4) Formular zurücksetzen und Zutaten-Felder neu initialisieren
    document.getElementById("newRecipeForm").reset();
    // Entferne alle existierenden Zeilen, dann füge genau eine leere hinzu:
    const container = document.getElementById("ingredientsContainer");
    container.innerHTML = `
      <label>Zutaten:</label>
      <div class="ingredient-row">
        <input type="text" class="ingredient-amount" placeholder="Menge (z.B. 50ml)" required />
        <input type="text" class="ingredient-item" placeholder="Zutat (z.B. Weißer Rum)" required />
        <button type="button" class="remove-ingredient">–</button>
      </div>
    `;
    attachIngredientRemoval();

    // 5) Liste neu laden, damit das soeben hinzugefügte Rezept direkt sichtbar ist
    loadRecipes();
  } catch (err) {
    console.error("Fehler beim Erstellen des Rezepts:", err);
    alert("Beim Abspeichern ist ein Fehler aufgetreten. Bitte erneut versuchen.");
  }
}

// Setup beim Seitensprung: Listener registrieren
document.addEventListener("DOMContentLoaded", () => {
  // 1) Initaler Datenabruf
  loadRecipes();

  // 2) Listener für das Formular
  document
    .getElementById("newRecipeForm")
    .addEventListener("submit", handleNewRecipeSubmit);

  // 3) Listener um eine neue Zutat-Zeile hinzuzufügen
  document
    .getElementById("addIngredient")
    .addEventListener("click", () => {
      addIngredientRow();
      attachIngredientRemoval();
    });

  // 4) Entfernen-Schaltflächen initial aktivieren
  attachIngredientRemoval();
});

/** ====== ENDE des neuen Formular-Teils ====== ====== **/

// Damit filterByType() und searchRecipes() global aufrufbar bleiben:
window.filterByType = filterByType;
window.searchRecipes = searchRecipes;
