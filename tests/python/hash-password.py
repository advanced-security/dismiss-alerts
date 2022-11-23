from Cryptodome.Hash import MD5, SHA256
import logging
import sys

LOGGER = logging.getLogger("LOGGER")


def hash_password():
    password = "password"
    logging.info("logging.info Password '%s'", password) #add suppression here to test

    LOGGER.log(logging.INFO, "LOGGER.log Password '%s'", password)  # NOT OK
    logging.root.info("logging.root.info Password '%s'", password)  # NOT OK

    # name of logger variable should not matter
    foo = LOGGER
    foo.info("foo.info Password '%s'", password)  # NOT OK
    hasher = MD5.new()
    hasher.update(password)
    return hasher.hexdigest()
