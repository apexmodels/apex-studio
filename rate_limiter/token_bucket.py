import time
import threading

class TokenBucket:
    def __init__(self, capacity: int, refill_rate: float):
        """
        Initialize the token bucket with a given capacity and refill rate.

        :param capacity: Maximum number of tokens the bucket can hold.
        :param refill_rate: Number of tokens added to the bucket per second.
        """
        self._capacity = capacity
        self._tokens = capacity  # Start with full capacity
        self._last_refill_timestamp = time.time()
        self._refill_rate = refill_rate
        self._lock = threading.Lock()

    def _refill_tokens(self):
        """
        Refill tokens in the bucket based on the elapsed time since the last refill.
        This method is thread-safe.
        """
        with self._lock:
            now = time.time()
            elapsed = now - self._last_refill_timestamp
            new_tokens = elapsed * self._refill_rate
            if new_tokens > 0:
                self._tokens = min(self._capacity, self._tokens + new_tokens)
                self._last_refill_timestamp = now

    def consume(self, tokens: int) -> bool:
        """
        Attempt to consume a specified number of tokens from the bucket.

        :param tokens: Number of tokens to consume.
        :return: True if the tokens were successfully consumed, False otherwise.
        """
        with self._lock:
            self._refill_tokens()
            if self._tokens >= tokens:
                self._tokens -= tokens
                return True
            return False

    def get_available_tokens(self) -> float:
        """
        Get the current number of available tokens in the bucket.

        :return: The number of available tokens.
        """
        with self._lock:
            self._refill_tokens()
            return self._tokens