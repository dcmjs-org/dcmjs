// @dcmjs-org/validator is a scaffold (RELEASE_PLAN.md section 11): the real
// validation work against @dcmjs-org/schemas is deferred to its own design
// discussion ("slice H"). This stub throws so nothing can silently depend on
// validation existing before it does.
export function validate() {
    throw new Error(
        "@dcmjs-org/validator is not implemented yet. Dataset validation " +
            "against @dcmjs-org/schemas is deferred (slice H); see the " +
            "package README and RELEASE_PLAN.md section 11."
    );
}
