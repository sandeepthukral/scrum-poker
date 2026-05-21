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

  /**
   * Returns { high: [names], low: [names] } for users whose numeric votes
   * are the highest or lowest after reveal. Non-numeric votes (?, ☕, null)
   * are ignored. Returns empty arrays when there's consensus or too few voters.
   */
  function getOutliers(users) {
    const numericUsers = users.filter(u => {
      if (u.vote === null || u.vote === '?' || u.vote === '☕') return false;
      return !isNaN(parseFloat(u.vote));
    });

    if (numericUsers.length < 2) return { high: [], low: [] };

    const values = numericUsers.map(u => parseFloat(u.vote));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);

    if (minVal === maxVal) return { high: [], low: [] };

    return {
      high: numericUsers.filter(u => parseFloat(u.vote) === maxVal).map(u => u.name),
      low:  numericUsers.filter(u => parseFloat(u.vote) === minVal).map(u => u.name),
    };
  }

  exports.nearestFibonacci = nearestFibonacci;
  exports.getOutliers = getOutliers;
})(typeof module !== 'undefined' ? module.exports : window);
