# Sample recipes

A starter pack of 12 markdown recipe notes you can drop into your vault to:

- See what `meals` blocks and the analytics view look like with real data.
- Use as templates when writing your own recipes.
- Verify both Coach *and* [Pantry](https://github.com/Ekrizdis367/obsidian-pantry) parse the same frontmatter correctly.

## Install

1. Pick a folder in your vault for recipes (e.g. `Cooking/`).
2. Copy any or all of the `Breakfast/`, `Lunch/`, `Dinner/`, `Snacks/`, `Drinks/` folders into that location. The folder names matter (see [Meal type icons](#meal-type-icons) below).
3. Open **Settings → Community plugins → Coach → Recipe folders** and add the parent folder you chose (one folder per line). Subfolders are scanned automatically.
4. Open or create a note with a ` ```meals ` block, click **Add meal**, and search for one of the recipes.

## Frontmatter contract

Every sample uses the same shared format that works for both plugins:

```yaml
---
type: recipe          # Pantry opens this in its rich recipe view
groceryList: false    # set to true to include in this week's grocery list
servings: 4           # how many servings the recipe makes as written
calories: 1800        # totals for the recipe (will be divided by `servings`)
protein: 64
carbs: 268
fat: 48
---
```

| Field | Read by Coach? | Read by Pantry? |
| --- | --- | --- |
| `type: recipe` | no | yes — opens the recipe view |
| `groceryList` | no | yes — selection flag |
| `servings` | yes — divides nutrition by this | yes — used for "per serving" display |
| `calories` / `protein` / `carbs` / `fat` | yes — interpreted as recipe totals when `servings` is set | yes — recipe totals |
| `image` | no | yes — hero image |
| `multiplier` | no | yes — scales displayed quantities and grocery list |

So one note simultaneously feeds the meal log, the grocery list, and the recipe view.

## Meal type icons

Coach shows a small icon next to each logged meal. Type is detected in this order:

1. **Frontmatter override** — `type: meal | snack | drink` (or `mealType:` / `category:`).
2. **Folder name inference** — recipes inside a folder named `Breakfast`, `Lunch`, `Dinner`, `Meals`, `Entrees`, `Mains`, `Supper` → meal icon. `Snacks`, `Snack` → snack icon. `Drinks`, `Drink`, `Beverages`, `Smoothies` → drink icon.
3. **Default** — meal.

That's why these samples are organized into `Breakfast/`, `Lunch/`, `Dinner/`, `Snacks/`, and `Drinks/` — no per-recipe `type:` is needed for the icons to be correct (with one exception, `Snacks/Trail Mix.md`, which uses an explicit `type: snack` to demo the override).

## What each recipe demonstrates

| Recipe | Demonstrates |
| --- | --- |
| `Breakfast/Oatmeal with Berries.md` | Single-serving recipe, `#IgnoreIngredient` on a pantry staple. |
| `Breakfast/Greek Yogurt Parfait.md` | No-cook, high-protein, single-serving. |
| `Lunch/Chicken Caesar Wrap.md` | Single-serving with a wide ingredient list. |
| `Lunch/Tuna Salad Bowl.md` | `servings: 2` — Coach auto-divides totals. |
| `Dinner/Pasta with Tomato Sauce.md` | The canonical multi-serving recipe shared by both plugin READMEs. |
| `Dinner/Sheet Pan Salmon and Vegetables.md` | `servings: 2`, common units (`oz`, `lb`, `bunch`). |
| `Dinner/Beef Stir Fry.md` | `servings: 4`, longer ingredient list with mixed units. |
| `Snacks/Apple with Peanut Butter.md` | Folder-inferred snack icon, minimal ingredients. |
| `Snacks/Trail Mix.md` | Explicit `type: snack` override; large `servings` count. |
| `Drinks/Protein Shake.md` | Folder-inferred drink icon. |
| `Drinks/Iced Coffee with Milk.md` | Tiny recipe; useful for repeated daily logging. |
| `Drinks/Electrolyte Water.md` | Multiple `#IgnoreIngredient` tags; very low-calorie recipe. |

## Customizing

These are starting points — feel free to:

- Adjust the macros to match your own measurements (the defaults are reasonable but unverified).
- Set `groceryList: true` on the few you actually want to make this week.
- Add an `image:` field with a wikilink to a photo (e.g. `image: "[[salmon-photo.jpg]]"`).
- Reorganize folders. The plugin's only requirement is that they live somewhere inside one of your configured **Recipe folders**.
