def _generation_failure_headers(
    *,
    retryable: bool,
    failure_class: str,
    error_type: str,
) -> dict[str, str]:
    return {
        "X-Generation-Retryable": "true" if retryable else "false",
        "X-Generation-Failure-Class": failure_class,
        "X-Generation-Error-Type": error_type,
    }
