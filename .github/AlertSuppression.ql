/**
 * @name Alert suppression
 * @description Generates information about alert suppressions.
 * @kind alert-suppression
 * @id java/codeql-alert-suppression
 */

import java

/**
 * An alert suppression comment.
 */
class SuppressionComment extends Javadoc {
  string annotation;

  SuppressionComment() {
    // suppression comments must be single-line
    (
      isEolComment(this)
      or
      isNormalComment(this) and exists(int line | this.hasLocationInfo(_, line, _, line, _))
    ) and
    exists(string text | text = this.getChild(0).getText() |
      // match `codeql[...]` anywhere in the comment
      annotation =
        text.regexpFind("(?i)\\bcodeql\\s*\\[[^\\]]*\\]", _, _).regexpReplaceAll("^codeql", "lgtm")
      or
      // match `codeql` at the start of the comment and after semicolon
      annotation =
        text.regexpFind("(?i)(?<=^|;)\\s*codeql(?!\\B|\\s*\\[)", _, _)
            .trim()
            .regexpReplaceAll("^codeql", "lgtm")
    )
  }

  /**
   * Gets the text of this suppression comment.
   */
  string getText() { result = this.getChild(0).getText() }

  /** Gets the suppression annotation in this comment. */
  string getAnnotation() { result = annotation }

  /**
   * Holds if this comment applies to the range from column `startcolumn` of line `startline`
   * to column `endcolumn` of line `endline` in file `filepath`.
   */
  predicate covers(string filepath, int startline, int startcolumn, int endline, int endcolumn) {
    this.getLocation().hasLocationInfo(filepath, _, _, startline - 1, _) and
    startcolumn = 1 and
    endline = startline + 1 and
    endcolumn = 1
  }

  /** Gets the scope of this suppression. */
  SuppressionScope getScope() { this = result.getSuppressionComment() }
}

/**
 * The scope of an alert suppression comment.
 */
class SuppressionScope extends @javadoc {
  SuppressionScope() { this instanceof SuppressionComment }

  /** Gets a suppression comment with this scope. */
  SuppressionComment getSuppressionComment() { result = this }

  /**
   * Holds if this element is at the specified location.
   * The location spans column `startcolumn` of line `startline` to
   * column `endcolumn` of line `endline` in file `filepath`.
   * For more information, see
   * [Locations](https://codeql.github.com/docs/writing-codeql-queries/providing-locations-in-codeql-queries/).
   */
  predicate hasLocationInfo(
    string filepath, int startline, int startcolumn, int endline, int endcolumn
  ) {
    this.(SuppressionComment).covers(filepath, startline, startcolumn, endline, endcolumn)
  }

  /** Gets a textual representation of this element. */
  string toString() { result = "suppression range" }
}

from SuppressionComment c
select c, // suppression comment
  c.getText(), // text of suppression comment (excluding delimiters)
  c.getAnnotation(), // text of suppression annotation
  c.getScope() // scope of suppression
