export const MEAL_PLAN_OPTIONS = [
    { value: 'BREAKFAST', label: 'Завтрак', shortLabel: 'Завтрак' },
    { value: 'LUNCH', label: 'Обед', shortLabel: 'Обед' },
    { value: 'DINNER', label: 'Ужин', shortLabel: 'Ужин' },
] as const;

export type MealPlanCode = typeof MEAL_PLAN_OPTIONS[number]['value'];

const allowedMealPlanValues = new Set<string>(MEAL_PLAN_OPTIONS.map((option) => option.value));

export const normalizeMealPlan = (value?: string[] | null) => {
    if (!Array.isArray(value)) {
        return [] as MealPlanCode[];
    }

    return Array.from(new Set(value.filter((item): item is MealPlanCode => allowedMealPlanValues.has(item))));
};

export const mealPlanLabels = (value?: string[] | null) => {
    const selected = normalizeMealPlan(value);
    return MEAL_PLAN_OPTIONS
        .filter((option) => selected.includes(option.value))
        .map((option) => option.label);
};
