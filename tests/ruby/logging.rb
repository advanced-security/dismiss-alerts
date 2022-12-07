stdout_logger = Logger.new STDOUT

password = "password"

# BAD: password logged as plaintext
stdout_logger.info password
# BAD: password logged as plaintext
stdout_logger.debug password
# BAD: password logged as plaintext
stdout_logger.error password
# BAD: password logged as plaintext
stdout_logger.fatal password
# BAD: password logged as plaintext
stdout_logger.unknown password
# BAD: password logged as plaintext
stdout_logger.warn password

# BAD: password logged as plaintext
stdout_logger.add Logger::WARN, password
# BAD: password logged as plaintext
stdout_logger.add Logger::WARN, "message", password
# BAD: password logged as plaintext
stdout_logger.log Logger::WARN, password

# BAD: password logged as plaintext

stdout_logger << "pw: #{password}" #add suppression here to test
#
