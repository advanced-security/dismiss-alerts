"use strict";
exports.id = 351;
exports.ids = [351];
exports.modules = {

/***/ 1351:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   context: () => (/* binding */ context),
/* harmony export */   getOctokit: () => (/* binding */ getOctokit)
/* harmony export */ });
/* harmony import */ var _context_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(7157);
/* harmony import */ var _utils_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(6536);


const context = new _context_js__WEBPACK_IMPORTED_MODULE_0__/* .Context */ .o();
/**
 * Returns a hydrated octokit ready to use for GitHub Actions
 *
 * @param     token    the repo PAT or GITHUB_TOKEN
 * @param     options  other options to set
 */
function getOctokit(token, options, ...additionalPlugins) {
    const GitHubWithPlugins = _utils_js__WEBPACK_IMPORTED_MODULE_1__.GitHub.plugin(...additionalPlugins);
    return new GitHubWithPlugins((0,_utils_js__WEBPACK_IMPORTED_MODULE_1__.getOctokitOptions)(token, options));
}
//# sourceMappingURL=github.js.map

/***/ })

};
;
//# sourceMappingURL=351.index.js.map