/* ── Shared utilities ── */

(function (exports) {
  /**
   * Returns the Fibonacci number closest to n.
   * The sequence used is: 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, …
   * For n ≤ 0 the result is 1 (the smallest Fibonacci number).
   * Ties (equidistant between two consecutive Fibonacci numbers) resolve
   * to the larger of the two.
   */
  function nearestFibonacci(n) {
    if (n <= 0) return 1;

    // Build the sequence up to a value that brackets n
    const fibs = [1, 2];
    while (fibs[fibs.length - 1] < n) {
      const len = fibs.length;
      fibs.push(fibs[len - 1] + fibs[len - 2]);
    }

    return fibs.reduce((nearest, fib) =>
      Math.abs(fib - n) <= Math.abs(nearest - n) ? fib : nearest
    );
  }

  exports.nearestFibonacci = nearestFibonacci;
})(typeof module !== 'undefined' ? module.exports : window);
