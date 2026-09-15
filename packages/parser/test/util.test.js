import * as util from '../src/util';

describe('util', () => {

  describe('#isPrivateTag', () => {

    it('should return `true` for a private tag', () => {
      const isPrivateTag = util.isPrivateTag('x001d0010');
      expect(isPrivateTag).toBe(true);
    })

    it('should return `false` for a non-private tag', () => {
      const isPrivateTag = util.isPrivateTag('x00100010');
      expect(isPrivateTag).toBe(false);
    })

    it('should throw an exception', () => {
      // Arrange
      const tag = 'x100z0010';
      const invoker = () => util.isPrivateTag(tag);

      // Act / Assert
      expect(invoker).toThrow();
    });

  });

  describe('#parsePN', () => {

    describe('when parsing a full PN', () => {
      let val;

      beforeEach(() => {
        // Arrange
        const pnString = 'F^G^M^P^S';

        // Act
        val = util.parsePN(pnString);
      });

      it('should return the right family name', () => {
        // Assert
        expect(val.familyName).toBe('F');
      });

      it('should return the right given name', () => {
        // Assert
        expect(val.givenName).toBe('G');
      });

      it('should return the right middle name', () => {
        // Assert
        expect(val.middleName).toBe('M');
      });

      it('should return the right prefix', () => {
        // Assert
        expect(val.prefix).toBe('P');
      });

      it('should return the right suffix', () => {
        // Assert
        expect(val.suffix).toBe('S');
      });

    });

    describe('when parsing a partial PN', () => {
      let val;

      beforeEach(() => {
        // Arrange
        const pnString = 'F';

        // Act
        val = util.parsePN(pnString);
      });

      it('should return the right family name', () => {
        // Assert
        expect(val.familyName).toBe('F');
      });

      it('should return the right given name', () => {
        // Assert
        expect(val.givenName).toBeUndefined();
      });

      it('should return the right middle name', () => {
        // Assert
        expect(val.middleName).toBeUndefined();
      });

      it('should return the right prefix', () => {
        // Assert
        expect(val.prefix).toBeUndefined();
      });

      it('should return the right suffix', () => {
        // Assert
        expect(val.suffix).toBeUndefined();
      });

    });

  });

  describe('#parseTM', () => {

    describe('when parsing a full TM', () => {
      let val;

      beforeEach(() => {
        // Arrange
        const tmString = '081236.531000';

        // Act
        val = util.parseTM(tmString);
      });

      it('should return the right hours', () => {
        // Assert
        expect(val.hours).toBe(8);
      });

      it('should return the right minutes', () => {
        // Assert
        expect(val.minutes).toBe(12);
      });

      it('should return the right seconds', () => {
        // Assert
        expect(val.seconds).toBe(36);
      });

      it('should return the right fractionalSeconds', () => {
        // Assert
        expect(val.fractionalSeconds).toBe(531000);
      });

    });

    describe('when parsing a partial TM', () => {
      let val;

      beforeEach(() => {
        // Arrange
        const tmString = '08';

        // Act
        val = util.parseTM(tmString);
      });

      it('should return the right hours', () => {
        // Assert
        expect(val.hours).toBe(8);
      });

      it('should return the right minutes', () => {
        // Assert
        expect(val.minutes).toBeUndefined();
      });

      it('should return the right seconds', () => {
        // Assert
        expect(val.seconds).toBeUndefined();
      });

      it('should return the right fractionalSeconds', () => {
        // Assert
        expect(val.fractionalSeconds).toBeUndefined();
      });

    });

    describe('when parsing a partial fractional TM', () => {

      it('should return the expected value for no zeros', () => {
        // Arrange
        const tmString = '081236.5';

        // Act
        const val = util.parseTM(tmString);

        // Assert
        expect(val.hours).toBe(8);
        expect(val.minutes).toBe(12);
        expect(val.seconds).toBe(36);
        expect(val.fractionalSeconds).toBe(500000);
      });

      it('should return the expected value for leading and following zeros', () => {
        // Arrange
        const tmString = '081236.00500';

        // Act
        const val = util.parseTM(tmString);

        // Assert
        expect(val.hours).toBe(8);
        expect(val.minutes).toBe(12);
        expect(val.seconds).toBe(36);
        expect(val.fractionalSeconds).toBe(5000);
      });

    });

    describe('when parsing a invalid TM', () => {

      it('should throw an exception', () => {
        // Arrange
        const tmString = '241236.531000';
        const invoker = () => util.parseTM(tmString, true);

        // Act / Asset
        expect(invoker).toThrow();
      });

    });

    describe('when parsing a TM with bad seconds', () => {

      it('shoud throw an exception', () => {
        // Arrange
        const tmString = '236036.531000';
        const invoker = () => util.parseTM(tmString, true);

        // Act / Asset
        expect(invoker).toThrow();
      });

    });

    describe('when parsing a TM with bad seconds', () => {

      it('should throw an exception', () => {
        // Arrange
        const tmString = '232260.531000';
        const invoker = () => util.parseTM(tmString, true);

        // Act
        expect(invoker).toThrow();
      });

    });

    describe('when parsing a TM with bad fractional', () => {

      it('should throw an exception', () => {
        // Arrange
        const tmString = '232259.AA';
        const invoker = () => util.parseTM(tmString, true);

        // Act / Asset
        expect(invoker).toThrow();
      });

    });

  });

  describe('#parseDA', () => {

    describe('when parsing a valid DA', () => {

      it('should return the expected value', () => {
        // Arrange
        const daString = '20140329';

        // Act
        const val = util.parseDA(daString);

        // Assert
        expect(val.year).toBe(2014);
        expect(val.month).toBe(3);
        expect(val.day).toBe(29);
      });

    });

    describe('when parsing a DA with a bad month', () => {

      it('should throw an exception', () => {
        // Arrange
        const daString = '20150001';
        const invoker = () => util.parseDA(daString, true);

        // Act / Asset
        expect(invoker).toThrow();
      });

    });

    describe('when parsing a DA with a bad day', () => {

      it('should throw an exception', () => {
        // Arrange
        const daString = '20150100';
        const invoker = () => util.parseDA(daString, true);

        // Act
        expect(invoker).toThrow();
      });

    });

    describe('when parsing a DA that is not a leap year', () => {

      it('should throw an exception', () => {
        // Arrange
        const daString = '20150229';
        const invoker = () => util.parseDA(daString, true);

        // Act / Asset
        expect(invoker).toThrow();
      });

    });

    describe('when parsing DA that is a leap year', () => {

      it('should return the expected value', () => {
        // Arrange
        const daString = '20160229';

        // Act
        const val = util.parseDA(daString, true);

        // Assert
        expect(val.year).toBe(2016);
        expect(val.month).toBe(2);
        expect(val.day).toBe(29);
      });

    });

    describe('when parsing a DA with non-number characters on "day" positions', () => {

      it('should throw an exception', () => {
        // Arrange
        const daString = '201500AA';
        const invoker = () => util.parseDA(daString, true);

        // Act / Assert
        expect(invoker).toThrow();
      });

    });

    describe('when parsing a DA with non-number characters on "year" positions', () => {

      it('should throw an exception', () => {
        // Arrange
        const daString = 'AAAA0102';
        const invoker = () => util.parseDA(daString, true);

        // Act / Assert
        expect(invoker).toThrow();
      });

    });

    describe('when parsing a DA with non-number characters on "month" positions', () => {

      it('parseDA month not number', () => {
        // Arrange
        const daString = '2015AA02';
        const invoker = () => util.parseDA(daString, true);

        // Act / Assert
        expect(invoker).toThrow();
      });

    });

    describe('when parsing a date with invalid length', () => {

      it('should throw an exception', () => {
        // Arrange
        const daString = '201501';
        const invoker = () => util.parseDA(daString, true);

        // Act / Assert
        expect(invoker).toThrow();
      });

    });

  });

});
