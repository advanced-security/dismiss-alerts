#include <ctype.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <stdint.h>
#include <unistd.h>

void write_info(char *userName);
void overflow();

int main(int argc, char **argv) {
  char *userName = argv[2];
  // BAD
  write_info(userName);

  overflow();

  return 0;
}

void write_info(char *userName) {
  sqlite3 *db;
  int rc;
  char *zErrMsg = 0;
  char query[1000] = {0};

  /* open db */
  rc = sqlite3_open("users.sqlite", &db);
  /* Write info */
  sprintf(query, "SELECT UID FROM USERS where name = \"%s\"", userName);
  rc = sqlite3_exec(db, query, NULL, 0, &zErrMsg); //add suppression here to test 
  sqlite3_close(db);
}

void overflow() {
  //codeql
  uint16_t v = 65535;
  uint16_t b = 1;
  uint16_t result;
  if (v + b < v) {
    printf("overflow");
  } else {
    result = v + b;
  }
}
