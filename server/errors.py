"""One exception type for every API error, rendered as the contract error JSON."""
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after

    def response(self) -> JSONResponse:
        body: dict = {"code": self.code, "message": self.message}
        headers = {}
        if self.retry_after is not None:
            body["retry_after"] = self.retry_after
            headers["Retry-After"] = str(self.retry_after)
        return JSONResponse({"error": body}, status_code=self.status, headers=headers)


def invalid_request(message: str = "The request is missing a field or has the wrong type.") -> ApiError:
    return ApiError(400, "invalid_request", message)


def unknown_scenario() -> ApiError:
    return ApiError(400, "unknown_scenario", "This scenario does not exist or is not available yet.")


def session_not_found() -> ApiError:
    return ApiError(404, "session_not_found", "This session has expired or does not exist.")
