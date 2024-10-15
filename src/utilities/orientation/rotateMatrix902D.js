import ndarray from "ndarray";

/**
 * anonymous function - Rotates a matrix by 90 degrees.
 *
 * @param  {Ndarray} matrix The matrix to rotate.
 * @return {Ndarry}        The rotated matrix.
 */
export default function (matrix) {
    const [rows, cols] = matrix.shape;

    let result = ndarray(new Uint8Array(rows * cols), [cols, rows]);

    let resultColsMinus1 = result.shape[1] - 1;

    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            result.set(j, resultColsMinus1 - i, matrix.get(i, j));
        }
    }

    return result;
}
